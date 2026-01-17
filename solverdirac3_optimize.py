#!/usr/bin/env python3
"""
DIRAC-3 optimizer for the 48h MVP allocator.

Reads:
  data/pools.json
  data/hedges.json
  data/scenarios.json

Runs:
  - Builds a higher-order polynomial energy (minimization) over binary variables
  - Submits to DIRAC-3 with job_type='sample-hamiltonian-integer'
  - Decodes best solution
  - Writes result.json

Important:
- Do NOT print or log your API token.   
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from typing import Dict, List, Tuple, Any, Optional

from dotenv import load_dotenv
from qci_client import QciClient, JobStatus  # qci-client v4.5+ pattern in docs


# -----------------------------
# Config knobs (tweak fast)
# -----------------------------
MODEL_CFG = {
    # Convert "scores" into APR-ish penalties (only used if your JSON fields are scores not APRs)
    # If your il_risk_score is already APR, set IL_SCORE_TO_APR = 1.0.
    "IL_SCORE_TO_APR": 1.0,

    # Convert MEV risk score into APR penalty (if mev_risk_score is 0..1-ish)
    "MEV_SCORE_TO_APR": 0.02,  # 0.5 -> 1% APR penalty (0.5 * 0.02)

    # Failure probability -> expected loss APR proxy per rebalance
    "FAIL_PROB_TO_APR": 0.03,  # 0.2 -> 0.6% APR penalty (0.2 * 0.03)

    # Extra per-rebalance overhead when you hedge (more txs)
    "HEDGE_EXTRA_GAS_MULTIPLIER": 0.6,  # +60% gas when hedging

    # Penalty strength for one-hot constraints (auto-scaled later, this is a multiplier)
    "LAMBDA_MULT": 20.0,

    # If your numbers are huge, we rescale coefficients to keep them tame
    "TARGET_MAX_COEF_ABS": 25.0,
}


# -----------------------------
# Helpers: JSON loading
# -----------------------------
def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _coerce_root_list(obj: Any, key: str) -> List[dict]:
    """
    Accept either:
      - {"pools":[...]} or {"scenarios":[...]} etc
      - [...] directly
    """
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict) and key in obj and isinstance(obj[key], list):
        return obj[key]
    raise ValueError(f"Expected list or dict[{key}] list in {key}. Got: {type(obj)}")


def _get_in(d: dict, path: List[str], default=None):
    cur = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return cur


# -----------------------------
# Term builder for Dirac-3 polynomial file format
# -----------------------------
class PolyBuilder:
    """
    Stores terms as mapping: monomial (tuple of var indices, repeated for powers) -> coefficient
    Example:
      x1*x2*x2  => monomial (1,2,2)
    """
    def __init__(self, max_degree: int):
        self.max_degree = max_degree
        self.terms: Dict[Tuple[int, ...], float] = {}

    def add(self, monomial: Tuple[int, ...], coef: float):
        if abs(coef) < 1e-12:
            return
        if len(monomial) == 0:
            # Dirac-3 constant term not supported; omit. :contentReference[oaicite:4]{index=4}
            return
        if len(monomial) > self.max_degree:
            raise ValueError(f"Monomial degree {len(monomial)} > max_degree {self.max_degree}")
        mono = tuple(sorted(monomial))  # must be non-decreasing :contentReference[oaicite:5]{index=5}
        self.terms[mono] = self.terms.get(mono, 0.0) + float(coef)

    def to_polynomial_file(self, file_name: str, num_variables: int) -> dict:
        degrees = [len(m) for m in self.terms.keys()]
        min_degree = min(degrees) if degrees else 1
        max_degree = self.max_degree

        data = []
        for mono, coef in self.terms.items():
            # Pad with zeros to length max_degree, as required :contentReference[oaicite:6]{index=6}
            idx = [0] * (max_degree - len(mono)) + list(mono)
            data.append({"idx": idx, "val": coef})

        return {
            "file_name": file_name,
            "file_config": {
                "polynomial": {
                    "num_variables": num_variables,
                    "min_degree": min_degree,
                    "max_degree": max_degree,
                    "data": data,
                }
            }
        }


# -----------------------------
# Variable layout
# -----------------------------
@dataclass(frozen=True)
class Group:
    name: str
    keys: List[str]               # display keys (POOL_1, none, M, weekly, 14D)
    var_indices: List[int]        # 1-based indices for Dirac polynomial


def build_variables(pools: dict, hedges: dict, scenarios: dict) -> Tuple[List[Group], Dict[str, Group]]:
    pools_list = _coerce_root_list(pools, "pools")
    hedge_types = hedges.get("hedge_types", [])
    tenor_buckets = hedges.get("tenor_buckets", [])  # optional
    buckets = pools.get("buckets", pools.get("bucket", {})) if isinstance(pools, dict) else {}
    size_buckets = buckets.get("size_buckets", pools.get("size_buckets", []))
    rebalance_buckets = buckets.get("rebalance_buckets", pools.get("rebalance_buckets", []))

    if not pools_list or len(pools_list) < 3:
        raise ValueError("Need at least 3 pools in pools.json")

    # Keys
    pool_keys = [p["pool_id"] for p in pools_list]
    hedge_keys = [h["key"] for h in hedge_types] if hedge_types else ["none", "protective_put", "collar"]
    size_keys = [s["key"] for s in size_buckets] if size_buckets else ["S", "M", "L"]
    reb_keys = [r["key"] for r in rebalance_buckets] if rebalance_buckets else ["daily", "weekly"]
    tenor_keys = [t["key"] for t in tenor_buckets] if tenor_buckets else []  # optional

    # Build sequential indices (1-based)
    groups: List[Group] = []
    idx = 1

    def _make_group(name: str, keys: List[str]) -> Group:
        nonlocal idx
        inds = list(range(idx, idx + len(keys)))
        idx += len(keys)
        return Group(name=name, keys=keys, var_indices=inds)

    groups.append(_make_group("pool", pool_keys))
    groups.append(_make_group("hedge", hedge_keys))
    groups.append(_make_group("size", size_keys))
    groups.append(_make_group("rebalance", reb_keys))
    if tenor_keys:
        groups.append(_make_group("tenor", tenor_keys))

    gmap = {g.name: g for g in groups}
    return groups, gmap


# -----------------------------
# Coefficient helpers (APR-ish)
# -----------------------------
def pick_scenario(scenarios_json: dict, scenario_id: str) -> dict:
    sc_list = _coerce_root_list(scenarios_json, "scenarios")
    for s in sc_list:
        if s.get("scenario_id") == scenario_id:
            return s
    raise ValueError(f"Scenario '{scenario_id}' not found in scenarios.json")


def get_bucket_maps(pools_json: dict) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    buckets = pools_json.get("buckets", pools_json.get("bucket", {}))
    size_buckets = buckets.get("size_buckets", pools_json.get("size_buckets", []))
    rebalance_buckets = buckets.get("rebalance_buckets", pools_json.get("rebalance_buckets", []))

    size_map = {b["key"]: b for b in size_buckets} if size_buckets else {
        "S": {"key": "S", "notional_usd": 1000, "multiplier": 0.5},
        "M": {"key": "M", "notional_usd": 5000, "multiplier": 1.0},
        "L": {"key": "L", "notional_usd": 20000, "multiplier": 2.0},
    }
    reb_map = {b["key"]: b for b in rebalance_buckets} if rebalance_buckets else {
        "daily": {"key": "daily", "rebalance_per_week": 7, "multiplier": 1.8},
        "weekly": {"key": "weekly", "rebalance_per_week": 1, "multiplier": 1.0},
    }
    return size_map, reb_map


def hedge_params(hedges_json: dict, pool_id: str, hedge_key: str, tenor_key: Optional[str], size_key: str) -> Tuple[float, float]:
    """
    Returns: (hedge_cost_apr, il_multiplier)
    """
    # Defaults
    hedge_types = {h["key"]: h for h in hedges_json.get("hedge_types", [])}
    if hedge_key in hedge_types:
        base_cost = float(hedge_types[hedge_key].get("default_cost_apr", 0.0))
        base_il_mult = float(hedge_types[hedge_key].get("default_il_multiplier", 1.0))
    else:
        # fallback defaults
        base_cost = 0.0 if hedge_key == "none" else (0.06 if hedge_key == "protective_put" else 0.03)
        base_il_mult = 1.0 if hedge_key == "none" else (0.65 if hedge_key == "protective_put" else 0.8)

    # Pool-specific overrides (optional)
    overrides = hedges_json.get("pool_overrides", [])
    if tenor_key:
        for ov in overrides:
            if ov.get("pool_id") == pool_id:
                tmap = ov.get("tenor_overrides", {})
                if tenor_key in tmap and hedge_key in tmap[tenor_key]:
                    entry = tmap[tenor_key][hedge_key]
                    base_cost = float(entry.get("cost_apr", base_cost))
                    base_il_mult = float(entry.get("il_multiplier", base_il_mult))

    # Size scaling (optional)
    size_scaling = hedges_json.get("size_scaling", {})
    if size_key in size_scaling:
        base_cost *= float(size_scaling[size_key].get("cost_multiplier", 1.0))
        base_il_mult *= float(size_scaling[size_key].get("benefit_multiplier", 1.0))

    return base_cost, base_il_mult


# -----------------------------
# Build the HUBO objective
# -----------------------------
def build_energy_polynomial(
    pools_json: dict,
    hedges_json: dict,
    scenarios_json: dict,
    scenario_id: str,
    groups: List[Group],
    gmap: Dict[str, Group],
) -> Tuple[PolyBuilder, dict]:
    """
    Energy (minimize) = penalties + costs - rewards.
    We'll encode:
      - reward: pool linear (negated)
      - IL penalty: pool*size*rebalance*hedge (4th) (+)
      - hedge cost: pool*size*hedge*(tenor optional) (3rd/4th) (+)
      - execution drag: pool*size*rebalance (3rd) (+)
      - hedge overhead exec: pool*size*rebalance*hedge (4th) (+)
      - one-hot constraints: quadratic penalties for each group (+)
    """
    pools_list = _coerce_root_list(pools_json, "pools")
    scenario = pick_scenario(scenarios_json, scenario_id)
    mult = scenario.get("multipliers", {})

    size_map, reb_map = get_bucket_maps(pools_json)

    has_tenor = "tenor" in gmap
    max_degree = 5 if has_tenor else 4
    pb = PolyBuilder(max_degree=max_degree)

    # Create quick lookup from key -> index
    def idx_of(group_name: str, key: str) -> int:
        g = gmap[group_name]
        return g.var_indices[g.keys.index(key)]

    # --- Reward term: choose pool (maximize reward -> minimize -reward)
    # Reward is APR; scenario can scale reward.
    for p in pools_list:
        pool_id = p["pool_id"]
        reward_fee = float(_get_in(p, ["reward", "fee_apr"], 0.0))
        reward_inc = float(_get_in(p, ["reward", "incentive_apr"], 0.0))
        reward_base = float(_get_in(p, ["reward", "base_apr"], 0.0))
        gross_apr = (reward_fee + reward_inc + reward_base) * float(mult.get("reward_multiplier", 1.0))

        pb.add((idx_of("pool", pool_id),), coef=-gross_apr)  # negate for minimization :contentReference[oaicite:7]{index=7}

    # --- Higher-order penalties/costs
    pool_keys = gmap["pool"].keys
    hedge_keys = gmap["hedge"].keys
    size_keys = gmap["size"].keys
    reb_keys = gmap["rebalance"].keys
    tenor_keys = gmap["tenor"].keys if has_tenor else [None]

    for pool_id in pool_keys:
        # pool-level inputs
        pool = next(p for p in pools_list if p["pool_id"] == pool_id)

        il_score = float(_get_in(pool, ["risk", "il_risk_score"], 0.0))
        il_apr_base = il_score * MODEL_CFG["IL_SCORE_TO_APR"] * float(mult.get("il_risk_multiplier", 1.0))

        gas_usd = float(_get_in(pool, ["execution", "gas_cost_usd_per_rebalance"], 0.0)) * float(mult.get("gas_multiplier", 1.0))
        slippage_bps = float(_get_in(pool, ["execution", "slippage_bps_per_rebalance"], 0.0)) * float(mult.get("slippage_multiplier", 1.0))
        mev_score = float(_get_in(pool, ["execution", "mev_risk_score"], 0.0)) * float(mult.get("mev_multiplier", 1.0))
        fail_prob = float(_get_in(pool, ["execution", "failure_prob_per_rebalance"], 0.0)) * float(mult.get("failure_multiplier", 1.0))

        liquidity_unwind_usd = float(_get_in(pool, ["risk", "liquidity_unwind_cost_usd"], 0.0))

        for size_key in size_keys:
            size_notional = float(size_map.get(size_key, {}).get("notional_usd", 5000.0))
            size_mult = float(size_map.get(size_key, {}).get("multiplier", 1.0))

            # Convert fixed USD costs to APR-ish by dividing by notional
            gas_apr_per_reb = gas_usd / max(size_notional, 1.0)
            unwind_apr = liquidity_unwind_usd / max(size_notional, 1.0)

            # Slippage bps is already proportional; we scale with size_mult to represent bigger trades worse price impact
            slippage_apr_per_reb = (slippage_bps / 10000.0) * (size_mult ** 1.2)

            mev_apr_per_reb = mev_score * MODEL_CFG["MEV_SCORE_TO_APR"] * (size_mult ** 1.1)
            fail_apr_per_reb = fail_prob * MODEL_CFG["FAIL_PROB_TO_APR"] * (size_mult ** 1.0)

            for reb_key in reb_keys:
                reb_per_week = float(reb_map.get(reb_key, {}).get("rebalance_per_week", 1.0))
                reb_mult = float(reb_map.get(reb_key, {}).get("multiplier", 1.0))

                # Annualize per-rebalance costs into APR-ish numbers
                per_reb_cost_apr = (gas_apr_per_reb + slippage_apr_per_reb + mev_apr_per_reb + fail_apr_per_reb) * reb_per_week * 52.0
                per_reb_cost_apr *= reb_mult

                # Add unwind as a small fixed annual penalty (simple proxy)
                exec_drag_apr = per_reb_cost_apr + 0.1 * unwind_apr

                # term: pool * size * rebalance  (3rd order)
                pb.add(
                    (idx_of("pool", pool_id), idx_of("size", size_key), idx_of("rebalance", reb_key)),
                    coef=exec_drag_apr
                )

                for hedge_key in hedge_keys:
                    for tenor_key in tenor_keys:
                        h_cost_apr, h_il_mult = hedge_params(hedges_json, pool_id, hedge_key, tenor_key, size_key)

                        # IL penalty (bigger size, more frequent rebalance typically means more exposure / more churn)
                        il_penalty_apr = il_apr_base * (size_mult ** 1.0) * (reb_mult ** 0.8) * float(h_il_mult)

                        # term: pool * size * rebalance * hedge  (4th order)
                        pb.add(
                            (idx_of("pool", pool_id), idx_of("size", size_key), idx_of("rebalance", reb_key), idx_of("hedge", hedge_key)),
                            coef=il_penalty_apr
                        )

                        # Hedge cost: pool * size * hedge (* tenor optional)
                        # If tenor exists, include it so you get 4th/5th order structure.
                        mono = (idx_of("pool", pool_id), idx_of("size", size_key), idx_of("hedge", hedge_key))
                        if has_tenor and tenor_key is not None:
                            mono = mono + (idx_of("tenor", tenor_key),)
                        pb.add(mono, coef=h_cost_apr)

                        # Hedge adds extra execution overhead (extra txs) when hedge != none
                        if hedge_key != "none":
                            hedge_overhead = MODEL_CFG["HEDGE_EXTRA_GAS_MULTIPLIER"] * gas_apr_per_reb * reb_per_week * 52.0
                            mono2 = (idx_of("pool", pool_id), idx_of("size", size_key), idx_of("rebalance", reb_key), idx_of("hedge", hedge_key))
                            if has_tenor and tenor_key is not None:
                                # make it 5th order if tenor exists
                                mono2 = mono2 + (idx_of("tenor", tenor_key),)
                            pb.add(mono2, coef=hedge_overhead)

    # --- One-hot constraints: for each group enforce sum==1.
    # For binary vars, (sum-1)^2 simplifies to:
    #   -λ * sum(v_i) + 2λ * sum_{i<j}(v_i v_j)   (constant omitted)
    # This makes picking 0 or >1 options expensive and picking exactly 1 cheap.
    # (Uses binary property; safe because we set num_levels=[2].) :contentReference[oaicite:8]{index=8}

    # First, estimate scale so lambda dominates objective terms
    max_abs = max((abs(c) for c in pb.terms.values()), default=1.0)
    lam = MODEL_CFG["LAMBDA_MULT"] * max_abs

    for g in groups:
        # linear: -lam * v_i
        for vi in g.var_indices:
            pb.add((vi,), coef=-lam)
        # quadratic: +2lam * v_i v_j
        for vi, vj in combinations(g.var_indices, 2):
            pb.add((vi, vj), coef=2.0 * lam)

    meta = {
        "scenario_id": scenario_id,
        "lambda": lam,
        "max_degree": max_degree,
    }
    return pb, meta


# -----------------------------
# Submit to DIRAC-3
# -----------------------------
def run_dirac3(pb: PolyBuilder, num_variables: int, num_samples: int, relaxation_schedule: int, job_name: str) -> dict:
    # Load .env and read token/url
    load_dotenv(override=False)

    api_url = os.getenv("QCI_API_URL", "https://api.qci-prod.com")
    api_token = os.getenv("QCI_TOKEN") or os.getenv("QCI_ACCESS_TOKEN")
    if not api_token:
        raise RuntimeError("Missing API token. Put QCI_ACCESS_TOKEN (or QCI_TOKEN) in .env")

    client = QciClient(url=api_url, api_token=api_token)

    poly_file = pb.to_polynomial_file(
        file_name=f"kurtosis_allocator_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
        num_variables=num_variables,
    )

    file_resp = client.upload_file(file=poly_file)
    file_id = file_resp["file_id"]

    # Use integer job type and set num_levels to 2 => binary variables (0/1). :contentReference[oaicite:9]{index=9}
    job_body = client.build_job_body(
        job_type="sample-hamiltonian-integer",
        job_name=job_name,
        job_tags=["kurtosis", "mvp", "allocator"],
        job_params={
            "device_type": "dirac-3",
            "num_samples": int(num_samples),
            "relaxation_schedule": int(relaxation_schedule),
            "num_levels": [2],  # same upper bound for all variables is allowed :contentReference[oaicite:10]{index=10}
        },
        polynomial_file_id=file_id,
    )

    job_resp = client.process_job(job_body=job_body)
    if job_resp.get("status") != JobStatus.COMPLETED.value:
        raise RuntimeError(f"DIRAC-3 job did not complete. status={job_resp.get('status')}, resp={job_resp}")

    return job_resp


# -----------------------------
# Decode + build result.json
# -----------------------------
def decode_argmax(groups: List[Group], solution_vec: List[int]) -> Dict[str, str]:
    """
    solution_vec is length N, values are 0/1 for integer job type.
    """
    chosen = {}
    for g in groups:
        # Find which variable is 1; fall back to argmax (in case of weird sample)
        vals = [solution_vec[i - 1] for i in g.var_indices]  # convert 1-based -> 0-based
        best_pos = max(range(len(vals)), key=lambda k: vals[k])
        chosen[g.name] = g.keys[best_pos]
    return chosen


def compute_breakdown(pools_json: dict, hedges_json: dict, scenarios_json: dict, scenario_id: str, chosen: Dict[str, str]) -> Dict[str, Any]:
    pools_list = _coerce_root_list(pools_json, "pools")
    scenario = pick_scenario(scenarios_json, scenario_id)
    mult = scenario.get("multipliers", {})

    size_map, reb_map = get_bucket_maps(pools_json)
    pool = next(p for p in pools_list if p["pool_id"] == chosen["pool"])

    # rewards
    fee_apr = float(_get_in(pool, ["reward", "fee_apr"], 0.0))
    inc_apr = float(_get_in(pool, ["reward", "incentive_apr"], 0.0))
    base_apr = float(_get_in(pool, ["reward", "base_apr"], 0.0))
    gross_apr = (fee_apr + inc_apr + base_apr) * float(mult.get("reward_multiplier", 1.0))

    # sizing & rebalance
    size_key = chosen["size"]
    reb_key = chosen["rebalance"]
    size_notional = float(size_map.get(size_key, {}).get("notional_usd", 5000.0))
    size_mult = float(size_map.get(size_key, {}).get("multiplier", 1.0))
    reb_per_week = float(reb_map.get(reb_key, {}).get("rebalance_per_week", 1.0))
    reb_mult = float(reb_map.get(reb_key, {}).get("multiplier", 1.0))

    # hedge terms
    hedge_key = chosen["hedge"]
    tenor_key = chosen.get("tenor", None)
    h_cost_apr, h_il_mult = hedge_params(hedges_json, pool["pool_id"], hedge_key, tenor_key, size_key)

    # IL penalty
    il_score = float(_get_in(pool, ["risk", "il_risk_score"], 0.0))
    il_apr_base = il_score * MODEL_CFG["IL_SCORE_TO_APR"] * float(mult.get("il_risk_multiplier", 1.0))
    il_penalty_apr = il_apr_base * (size_mult ** 1.0) * (reb_mult ** 0.8) * float(h_il_mult)

    # execution drag
    gas_usd = float(_get_in(pool, ["execution", "gas_cost_usd_per_rebalance"], 0.0)) * float(mult.get("gas_multiplier", 1.0))
    slippage_bps = float(_get_in(pool, ["execution", "slippage_bps_per_rebalance"], 0.0)) * float(mult.get("slippage_multiplier", 1.0))
    mev_score = float(_get_in(pool, ["execution", "mev_risk_score"], 0.0)) * float(mult.get("mev_multiplier", 1.0))
    fail_prob = float(_get_in(pool, ["execution", "failure_prob_per_rebalance"], 0.0)) * float(mult.get("failure_multiplier", 1.0))
    liquidity_unwind_usd = float(_get_in(pool, ["risk", "liquidity_unwind_cost_usd"], 0.0))

    gas_apr_per_reb = gas_usd / max(size_notional, 1.0)
    unwind_apr = liquidity_unwind_usd / max(size_notional, 1.0)
    slippage_apr_per_reb = (slippage_bps / 10000.0) * (size_mult ** 1.2)
    mev_apr_per_reb = mev_score * MODEL_CFG["MEV_SCORE_TO_APR"] * (size_mult ** 1.1)
    fail_apr_per_reb = fail_prob * MODEL_CFG["FAIL_PROB_TO_APR"] * (size_mult ** 1.0)

    exec_drag_apr = (gas_apr_per_reb + slippage_apr_per_reb + mev_apr_per_reb + fail_apr_per_reb) * reb_per_week * 52.0
    exec_drag_apr *= reb_mult
    exec_drag_apr += 0.1 * unwind_apr

    hedge_overhead_apr = 0.0
    if hedge_key != "none":
        hedge_overhead_apr = MODEL_CFG["HEDGE_EXTRA_GAS_MULTIPLIER"] * gas_apr_per_reb * reb_per_week * 52.0

    total_penalties = il_penalty_apr + h_cost_apr + exec_drag_apr + hedge_overhead_apr
    net_apr = gross_apr - total_penalties

    return {
        "rewards": {
            "fee_apr": fee_apr,
            "incentive_apr": inc_apr,
            "base_apr": base_apr,
            "total_gross_apr": gross_apr,
        },
        "penalties_and_costs": {
            "il_penalty_apr": il_penalty_apr,
            "hedge_cost_apr": h_cost_apr,
            "execution_drag_apr": exec_drag_apr,
            "hedge_overhead_apr": hedge_overhead_apr,
            "total_penalties_apr": total_penalties,
        },
        "net_apr": {
            "estimated_net_apr": net_apr,
        }
    }


def compute_baseline(pools_json: dict, scenarios_json: dict, scenario_id: str, chosen: Dict[str, str]) -> Dict[str, str]:
    """
    Baseline = "max gross APR, no hedge" (keep size & rebalance & tenor same for fair comparison).
    """
    pools_list = _coerce_root_list(pools_json, "pools")
    scenario = pick_scenario(scenarios_json, scenario_id)
    mult = scenario.get("multipliers", {})

    best_pool = None
    best_gross = -1e9
    for p in pools_list:
        fee_apr = float(_get_in(p, ["reward", "fee_apr"], 0.0))
        inc_apr = float(_get_in(p, ["reward", "incentive_apr"], 0.0))
        base_apr = float(_get_in(p, ["reward", "base_apr"], 0.0))
        gross = (fee_apr + inc_apr + base_apr) * float(mult.get("reward_multiplier", 1.0))
        if gross > best_gross:
            best_gross = gross
            best_pool = p["pool_id"]

    out = dict(chosen)
    out["pool"] = best_pool
    out["hedge"] = "none"
    return out


# -----------------------------
# Main
# -----------------------------
# -----------------------------
# Main
# -----------------------------
def run_optimization(
    pools_json: dict,
    hedges_json: dict,
    scenarios_json: dict,
    scenario_id: str,
    num_samples: int = 10,
    relaxation_schedule: int = 1,
) -> dict:
    """
    Main entry point for API calling.
    """
    print(f"[DEBUG] Starting optimization for scenario: {scenario_id}")
    print(f"[DEBUG] Config: num_samples={num_samples}, relaxation_schedule={relaxation_schedule}")

    groups, gmap = build_variables(pools_json, hedges_json, scenarios_json)
    print(f"[DEBUG] Built variable groups: {[g.name for g in groups]}")
    for g in groups:
        print(f"[DEBUG] Group {g.name}: keys={g.keys}, indices={g.var_indices}")

    pb, meta = build_energy_polynomial(pools_json, hedges_json, scenarios_json, scenario_id, groups, gmap)
    print(f"[DEBUG] Polynomial built. Max degree: {meta['max_degree']}")
    print(f"[DEBUG] Number of terms: {len(pb.terms)}")

    # Optional coefficient rescale (doesn't change argmin)
    max_abs = max((abs(c) for c in pb.terms.values()), default=1.0)
    target = MODEL_CFG["TARGET_MAX_COEF_ABS"]
    scale = 1.0
    if max_abs > target:
        scale = max_abs / target
        print(f"[DEBUG] Rescaling coefficients by {1/scale:.4f} (max_abs={max_abs:.2f} -> {target:.2f})")
        for k in list(pb.terms.keys()):
            pb.terms[k] = pb.terms[k] / scale

    num_variables = sum(len(g.keys) for g in groups)
    print(f"[DEBUG] Total variables: {num_variables}")

    print("[DEBUG] Submitting to DIRAC-3...")
    job_resp = run_dirac3(
        pb=pb,
        num_variables=num_variables,
        num_samples=num_samples,
        relaxation_schedule=relaxation_schedule,
        job_name=f"kurtosis_allocator_{scenario_id}",
    )
    print(f"[DEBUG] Job response status: {job_resp.get('status')}")

    energies = job_resp["results"]["energies"]
    solutions = job_resp["results"]["solutions"]
    counts = job_resp["results"].get("counts", [1] * len(solutions))
    print(f"[DEBUG] Received {len(energies)} samples")

    # pick best (lowest energy)
    best_i = min(range(len(energies)), key=lambda i: energies[i])
    best_energy = energies[best_i]
    best_solution = solutions[best_i]
    print(f"[DEBUG] Best energy: {best_energy}")

    # Integer job returns integer-ish values; coerce to ints
    sol_int = [int(round(v)) for v in best_solution]

    chosen = decode_argmax(groups, sol_int)
    print(f"[DEBUG] Decoded solution: {chosen}")

    breakdown = compute_breakdown(pools_json, hedges_json, scenarios_json, scenario_id, chosen)
    baseline_choice = compute_baseline(pools_json, scenarios_json, scenario_id, chosen)
    baseline_breakdown = compute_breakdown(pools_json, hedges_json, scenarios_json, scenario_id, baseline_choice)

    # Helpful labels
    pools_list = _coerce_root_list(pools_json, "pools")
    pool_label = next(p["label"] for p in pools_list if p["pool_id"] == chosen["pool"])
    baseline_pool_label = next(p["label"] for p in pools_list if p["pool_id"] == baseline_choice["pool"])

    explain = [
        "We picked the strategy with the best 'real outcome' after subtracting hidden costs.",
        "We penalize price-move risk (IL proxy) and real trading costs like gas and slippage.",
        "Adding a hedge can reduce big losses, but it also costs money and adds extra transactions.",
        "The baseline picks the highest headline APR with no hedge; our choice focuses on net result.",
    ]

    result = {
        "schema_version": "1.0",
        "as_of_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "inputs_used": {
            "scenario_id": scenario_id,
        },
        "decision": {
            "pool_id": chosen["pool"],
            "pool_label": pool_label,
            "hedge_type": chosen["hedge"],
            "tenor_bucket": chosen.get("tenor"),
            "size_bucket": chosen["size"],
            "rebalance_bucket": chosen["rebalance"],
        },
        "score": {
            # objective_value is energy; rescaling noted
            "objective_value": float(best_energy),
            "units": "DIRAC energy (scaled)" if scale != 1.0 else "DIRAC energy",
            "notes": {
                "coef_rescale": scale,
                "meta": meta
            }
        },
        "score_breakdown": breakdown,
        "baseline_comparison": {
            "baseline_id": "MAX_GROSS_APR_NO_HEDGE",
            "baseline_decision": {
                "pool_id": baseline_choice["pool"],
                "pool_label": baseline_pool_label,
                "hedge_type": "none",
                "tenor_bucket": baseline_choice.get("tenor"),
                "size_bucket": baseline_choice["size"],
                "rebalance_bucket": baseline_choice["rebalance"],
            },
            "baseline_score_breakdown": baseline_breakdown,
            "delta_vs_baseline": {
                "net_apr_improvement": breakdown["net_apr"]["estimated_net_apr"] - baseline_breakdown["net_apr"]["estimated_net_apr"]
            }
        },
        "explain_like_im_15": explain,
        "debug": {
            "energies": energies,
            "counts": counts,
            "chosen_binary_variables": {
                "vector": sol_int,
                "groups": {g.name: dict(zip(g.keys, [sol_int[i-1] for i in g.var_indices])) for g in groups}
            }
        }
    }
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pools", default="data/pools.json")
    ap.add_argument("--hedges", default="data/hedges.json")
    ap.add_argument("--scenarios", default="data/scenarios.json")
    ap.add_argument("--scenario", required=True, help="Scenario ID, e.g. CALM or CHAOTIC")
    ap.add_argument("--num-samples", type=int, default=10)
    ap.add_argument("--relaxation-schedule", type=int, default=1, choices=[1, 2, 3, 4])
    ap.add_argument("--out", default="result.json")
    args = ap.parse_args()

    pools_json = _load_json(args.pools)
    hedges_json = _load_json(args.hedges)
    scenarios_json = _load_json(args.scenarios)

    result = run_optimization(
        pools_json=pools_json,
        hedges_json=hedges_json,
        scenarios_json=scenarios_json,
        scenario_id=args.scenario,
        num_samples=args.num_samples,
        relaxation_schedule=args.relaxation_schedule
    )

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"Wrote {args.out}")
    print("Decision:", result["decision"])
    print("Net APR:", result["score_breakdown"]["net_apr"]["estimated_net_apr"])


if __name__ == "__main__":
    main()
