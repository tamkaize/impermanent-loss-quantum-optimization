import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================================================
// Logging helpers (request-correlated)
// =============================================================================
const textEncoder = new TextEncoder();

function makeRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function bytes(str: string): number {
  return textEncoder.encode(str).length;
}

function trunc(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(truncated)`;
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function logInfo(reqId: string, message: string, extra?: unknown) {
  if (extra === undefined) console.log(`[dirac-solver ${reqId}] ${message}`);
  else console.log(`[dirac-solver ${reqId}] ${message}`, extra);
}

function logWarn(reqId: string, message: string, extra?: unknown) {
  if (extra === undefined) console.warn(`[dirac-solver ${reqId}] ${message}`);
  else console.warn(`[dirac-solver ${reqId}] ${message}`, extra);
}

function logError(reqId: string, message: string, extra?: unknown) {
  if (extra === undefined) console.error(`[dirac-solver ${reqId}] ${message}`);
  else console.error(`[dirac-solver ${reqId}] ${message}`, extra);
}

// =============================================================================
// DIRAC-3 Optimizer Edge Function
// Port of the Python HUBO solver for the Kurtosis Labs allocator MVP
// =============================================================================

// Model configuration knobs
const MODEL_CFG = {
  IL_SCORE_TO_APR: 1.0,
  MEV_SCORE_TO_APR: 0.02,
  FAIL_PROB_TO_APR: 0.03,
  HEDGE_EXTRA_GAS_MULTIPLIER: 0.6,
  LAMBDA_MULT: 20.0,
  TARGET_MAX_COEF_ABS: 25.0,
};

// =============================================================================
// Types
// =============================================================================
interface Pool {
  pool_id: string;
  label: string;
  protocol: string;
  chain: string;
  strategy_type: string;
  tokens: string[];
  tvl_usd: number;
  fee_tier_bps: number;
  reward: {
    fee_apr: number;
    incentive_apr: number;
    base_apr: number;
  };
  risk: {
    il_risk_score: number;
    price_vol_score: number;
    liquidity_unwind_cost_usd: number;
  };
  execution: {
    gas_cost_usd_per_rebalance: number;
    slippage_bps_per_rebalance: number;
    mev_risk_score: number;
    failure_prob_per_rebalance: number;
  };
}

interface Hedges {
  hedge_types: {
    none: { cost_apr: number; il_multiplier: number };
    protective_put: { cost_apr: number; il_multiplier: number };
    collar: { cost_apr: number; il_multiplier: number };
  };
  tenor_buckets: string[];
  size_scaling: { S: number; M: number; L: number };
}

interface ScenarioMultipliers {
  reward_multiplier: number;
  il_risk_multiplier: number;
  gas_multiplier: number;
  slippage_multiplier: number;
  mev_multiplier: number;
  failure_multiplier: number;
}

interface Scenario {
  scenario_id: string;
  label: string;
  description: string;
  multipliers: ScenarioMultipliers;
}

interface SelectedBuckets {
  position_size_usd: number;
  rebalance_bucket: "daily" | "weekly" | "monthly";
  tenor_bucket: "7D" | "14D" | "30D";
}

interface SolverRequest {
  action?: "submit" | "status"; // async pattern: submit or check status
  job_id?: string; // for status action
  scenario_id: string;
  pools: Pool[];
  hedges: Hedges;
  scenarios: Scenario[];
  selected_buckets: SelectedBuckets;
  request_baseline?: boolean;
  num_samples?: number;
  relaxation_schedule?: number;
}

interface Group {
  name: string;
  keys: string[];
  var_indices: number[];
}

// =============================================================================
// Polynomial Builder (for DIRAC-3 HUBO format)
// =============================================================================
class PolyBuilder {
  private terms: Map<string, number> = new Map();
  private maxDegree: number;

  constructor(maxDegree: number) {
    this.maxDegree = maxDegree;
  }

  add(monomial: number[], coef: number): void {
    if (Math.abs(coef) < 1e-12) return;
    if (monomial.length === 0) return; // DIRAC-3 doesn't support constant terms
    if (monomial.length > this.maxDegree) {
      throw new Error(`Monomial degree ${monomial.length} > max_degree ${this.maxDegree}`);
    }

    const sorted = [...monomial].sort((a, b) => a - b);
    const key = sorted.join(",");
    this.terms.set(key, (this.terms.get(key) || 0) + coef);
  }

  getTerms(): Map<string, number> {
    return this.terms;
  }

  getMaxAbsCoef(): number {
    let maxAbs = 0;
    for (const coef of this.terms.values()) {
      maxAbs = Math.max(maxAbs, Math.abs(coef));
    }
    return maxAbs || 1.0;
  }

  rescale(factor: number): void {
    for (const [key, val] of this.terms.entries()) {
      this.terms.set(key, val / factor);
    }
  }

  toPolynomialFile(fileName: string, numVariables: number): object {
    const degrees = Array.from(this.terms.keys()).map((k) => k.split(",").length);
    const minDegree = Math.min(...degrees) || 1;

    const data = [];
    for (const [key, coef] of this.terms.entries()) {
      const indices = key.split(",").map(Number);
      // Pad with zeros to maxDegree length (zeros at front)
      const paddedIdx = new Array(this.maxDegree - indices.length).fill(0).concat(indices);
      data.push({ idx: paddedIdx, val: coef });
    }

    return {
      file_name: fileName,
      file_config: {
        polynomial: {
          num_variables: numVariables,
          min_degree: minDegree,
          max_degree: this.maxDegree,
          data,
        },
      },
    };
  }
}

// =============================================================================
// Variable Layout Builder
// =============================================================================
function buildVariables(
  pools: Pool[],
  hedges: Hedges,
  _scenarios: Scenario[],
): { groups: Group[]; gmap: Record<string, Group> } {
  const poolKeys = pools.map((p) => p.pool_id);
  const hedgeKeys = Object.keys(hedges.hedge_types);
  const tenorKeys = hedges.tenor_buckets || [];

  // Size buckets derived from position buckets
  const sizeKeys = ["S", "M", "L"];
  const rebKeys = ["daily", "weekly", "monthly"];

  const groups: Group[] = [];
  let idx = 1;

  const makeGroup = (name: string, keys: string[]): Group => {
    const indices = keys.map((_, i) => idx + i);
    idx += keys.length;
    return { name, keys, var_indices: indices };
  };

  groups.push(makeGroup("pool", poolKeys));
  groups.push(makeGroup("hedge", hedgeKeys));
  groups.push(makeGroup("size", sizeKeys));
  groups.push(makeGroup("rebalance", rebKeys));
  if (tenorKeys.length > 0) {
    groups.push(makeGroup("tenor", tenorKeys));
  }

  const gmap: Record<string, Group> = {};
  for (const g of groups) {
    gmap[g.name] = g;
  }

  return { groups, gmap };
}

// =============================================================================
// Coefficient Helpers
// =============================================================================
function getSizeBucketFromUsd(positionSizeUsd: number): "S" | "M" | "L" {
  if (positionSizeUsd < 10000) return "S";
  if (positionSizeUsd < 100000) return "M";
  return "L";
}

function getSizeNotionalAndMult(sizeKey: string): { notional: number; mult: number } {
  const map: Record<string, { notional: number; mult: number }> = {
    S: { notional: 1000, mult: 0.5 },
    M: { notional: 5000, mult: 1.0 },
    L: { notional: 20000, mult: 2.0 },
  };
  return map[sizeKey] || map["M"];
}

function getRebParams(rebKey: string): { perWeek: number; mult: number } {
  const map: Record<string, { perWeek: number; mult: number }> = {
    daily: { perWeek: 7, mult: 1.8 },
    weekly: { perWeek: 1, mult: 1.0 },
    monthly: { perWeek: 0.25, mult: 0.6 },
  };
  return map[rebKey] || map["weekly"];
}

function getHedgeParams(
  hedges: Hedges,
  hedgeKey: string,
  _poolId: string,
  _tenorKey: string | null,
  sizeKey: string,
): { costApr: number; ilMult: number } {
  const hedgeTypes = hedges.hedge_types as Record<string, { cost_apr: number; il_multiplier: number }>;
  const ht = hedgeTypes[hedgeKey] || { cost_apr: 0, il_multiplier: 1.0 };

  // Apply size scaling
  const sizeScaling = hedges.size_scaling as Record<string, number>;
  const sizeMult = sizeScaling[sizeKey] || 1.0;

  return {
    costApr: ht.cost_apr * sizeMult,
    ilMult: ht.il_multiplier,
  };
}

// =============================================================================
// Build Energy Polynomial (HUBO Objective)
// =============================================================================
function buildEnergyPolynomial(
  pools: Pool[],
  hedges: Hedges,
  scenarios: Scenario[],
  scenarioId: string,
  groups: Group[],
  gmap: Record<string, Group>,
): { pb: PolyBuilder; meta: object } {
  const scenario = scenarios.find((s) => s.scenario_id === scenarioId);
  if (!scenario) {
    throw new Error(`Scenario '${scenarioId}' not found`);
  }
  const mult = scenario.multipliers;

  const hasTenor = "tenor" in gmap;
  const maxDegree = hasTenor ? 5 : 4;
  const pb = new PolyBuilder(maxDegree);

  // Helper to get index
  const idxOf = (groupName: string, key: string): number => {
    const g = gmap[groupName];
    const pos = g.keys.indexOf(key);
    if (pos === -1) throw new Error(`Key ${key} not in group ${groupName}`);
    return g.var_indices[pos];
  };

  // --- Reward terms (negate for minimization) ---
  for (const p of pools) {
    const grossApr = (p.reward.fee_apr + p.reward.incentive_apr + p.reward.base_apr) * mult.reward_multiplier;
    pb.add([idxOf("pool", p.pool_id)], -grossApr);
  }

  // --- Higher-order penalty/cost terms ---
  const poolKeys = gmap["pool"].keys;
  const hedgeKeys = gmap["hedge"].keys;
  const sizeKeys = gmap["size"].keys;
  const rebKeys = gmap["rebalance"].keys;
  const tenorKeys = hasTenor ? gmap["tenor"].keys : [null];

  for (const poolId of poolKeys) {
    const pool = pools.find((p) => p.pool_id === poolId)!;

    const ilAprBase = pool.risk.il_risk_score * MODEL_CFG.IL_SCORE_TO_APR * mult.il_risk_multiplier;
    const gasUsd = pool.execution.gas_cost_usd_per_rebalance * mult.gas_multiplier;
    const slippageBps = pool.execution.slippage_bps_per_rebalance * mult.slippage_multiplier;
    const mevScore = pool.execution.mev_risk_score * mult.mev_multiplier;
    const failProb = pool.execution.failure_prob_per_rebalance * mult.failure_multiplier;
    const liquidityUnwindUsd = pool.risk.liquidity_unwind_cost_usd;

    for (const sizeKey of sizeKeys) {
      const { notional: sizeNotional, mult: sizeMult } = getSizeNotionalAndMult(sizeKey);

      const gasAprPerReb = gasUsd / Math.max(sizeNotional, 1.0);
      const unwindApr = liquidityUnwindUsd / Math.max(sizeNotional, 1.0);
      const slippageAprPerReb = (slippageBps / 10000.0) * Math.pow(sizeMult, 1.2);
      const mevAprPerReb = mevScore * MODEL_CFG.MEV_SCORE_TO_APR * Math.pow(sizeMult, 1.1);
      const failAprPerReb = failProb * MODEL_CFG.FAIL_PROB_TO_APR * sizeMult;

      for (const rebKey of rebKeys) {
        const { perWeek: rebPerWeek, mult: rebMult } = getRebParams(rebKey);

        let perRebCostApr = (gasAprPerReb + slippageAprPerReb + mevAprPerReb + failAprPerReb) * rebPerWeek * 52.0;
        perRebCostApr *= rebMult;
        const execDragApr = perRebCostApr + 0.1 * unwindApr;

        // 3rd order term: pool * size * rebalance
        pb.add([idxOf("pool", poolId), idxOf("size", sizeKey), idxOf("rebalance", rebKey)], execDragApr);

        for (const hedgeKey of hedgeKeys) {
          for (const tenorKey of tenorKeys) {
            const { costApr: hCostApr, ilMult: hIlMult } = getHedgeParams(hedges, hedgeKey, poolId, tenorKey, sizeKey);

            // IL penalty (4th order)
            const ilPenaltyApr = ilAprBase * sizeMult * Math.pow(rebMult, 0.8) * hIlMult;
            pb.add(
              [idxOf("pool", poolId), idxOf("size", sizeKey), idxOf("rebalance", rebKey), idxOf("hedge", hedgeKey)],
              ilPenaltyApr,
            );

            // Hedge cost: pool * size * hedge (* tenor if exists)
            const hedgeMono = [idxOf("pool", poolId), idxOf("size", sizeKey), idxOf("hedge", hedgeKey)];
            if (hasTenor && tenorKey !== null) {
              hedgeMono.push(idxOf("tenor", tenorKey));
            }
            pb.add(hedgeMono, hCostApr);

            // Hedge overhead (extra gas)
            if (hedgeKey !== "none") {
              const hedgeOverhead = MODEL_CFG.HEDGE_EXTRA_GAS_MULTIPLIER * gasAprPerReb * rebPerWeek * 52.0;
              const overheadMono = [
                idxOf("pool", poolId),
                idxOf("size", sizeKey),
                idxOf("rebalance", rebKey),
                idxOf("hedge", hedgeKey),
              ];
              if (hasTenor && tenorKey !== null) {
                overheadMono.push(idxOf("tenor", tenorKey));
              }
              pb.add(overheadMono, hedgeOverhead);
            }
          }
        }
      }
    }
  }

  // --- One-hot constraints using penalty method ---
  const maxAbs = pb.getMaxAbsCoef();
  const lam = MODEL_CFG.LAMBDA_MULT * maxAbs;

  for (const g of groups) {
    // Linear: -lam * v_i
    for (const vi of g.var_indices) {
      pb.add([vi], -lam);
    }
    // Quadratic: +2lam * v_i * v_j for all pairs
    for (let i = 0; i < g.var_indices.length; i++) {
      for (let j = i + 1; j < g.var_indices.length; j++) {
        pb.add([g.var_indices[i], g.var_indices[j]], 2.0 * lam);
      }
    }
  }

  const meta = {
    scenario_id: scenarioId,
    lambda: lam,
    max_degree: maxDegree,
  };

  return { pb, meta };
}

// =============================================================================
// QCI Auth Helper
// =============================================================================
async function getQciAuth(reqId: string): Promise<{ apiUrl: string; authHeader: string }> {
  const apiUrl = Deno.env.get("QCI_API_URL") || "https://api.qci-prod.com";
  const apiTokenRaw = (Deno.env.get("QCI_TOKEN") ?? Deno.env.get("QCI_ACCESS_TOKEN") ?? "").trim();

  if (!apiTokenRaw) {
    throw new Error("Missing QCI_TOKEN (or QCI_ACCESS_TOKEN) secret");
  }

  // Normalize token: users sometimes paste with leading "Bearer " or wrapping quotes.
  const apiToken = apiTokenRaw
    .replace(/^bearer\s+/i, "")
    .replace(/^"(.+)"$/, "$1")
    .replace(/^'(.+)'$/, "$1")
    .trim();

  // QCI commonly issues a long-lived refresh token; REST endpoints require a short-lived access token.
  let bearerToken = apiToken;
  const looksLikeJwt = apiToken.split(".").length === 3;

  if (!looksLikeJwt) {
    const exchangeUrl = `${apiUrl}/auth/v1/access-tokens`;
    logInfo(reqId, "Attempting QCI token exchange", { url: exchangeUrl, refresh_token_length: apiToken.length });

    try {
      const tokenResp = await fetch(exchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: apiToken }),
      });

      const tokenText = await tokenResp.text();
      logInfo(reqId, "QCI token exchange response", {
        status: tokenResp.status,
        ok: tokenResp.ok,
        body_preview: trunc(tokenText, 600),
      });

      const tokenJson = safeJsonParse(tokenText);
      const accessToken = tokenJson?.access_token;
      if (tokenResp.ok && typeof accessToken === "string" && accessToken.length > 0) {
        bearerToken = accessToken;
        logInfo(reqId, "QCI access token acquired", { access_token_length: bearerToken.length });
      } else {
        logWarn(reqId, "QCI token exchange did not return an access_token; using provided token as-is");
      }
    } catch (e) {
      logWarn(reqId, "QCI token exchange request failed; using provided token as-is", {
        message: (e as Error)?.message,
      });
    }
  }

  const authHeader = `Bearer ${bearerToken}`;
  logInfo(reqId, "QCI auth header prepared", {
    api_url: apiUrl,
    token_length: bearerToken.length,
    token_kind: looksLikeJwt ? "jwt" : "exchanged_or_raw",
  });

  return { apiUrl, authHeader };
}

// =============================================================================
// DIRAC-3 API Client - Submit Job (no polling)
// =============================================================================
async function submitDirac3Job(
  pb: PolyBuilder,
  numVariables: number,
  numSamples: number,
  relaxationSchedule: number,
  jobName: string,
  reqId: string,
): Promise<{ jobId: string; fileId: string }> {
  const { apiUrl, authHeader } = await getQciAuth(reqId);

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const polyFile = pb.toPolynomialFile(`kurtosis_allocator_${timestamp}`, numVariables);
  const polyJson = JSON.stringify(polyFile);

  logInfo(reqId, "Polynomial file built", {
    num_variables: numVariables,
    max_degree: (polyFile as any)?.file_config?.polynomial?.max_degree,
    min_degree: (polyFile as any)?.file_config?.polynomial?.min_degree,
    terms: pb.getTerms().size,
    json_bytes: bytes(polyJson),
  });

  // Step 1: Upload polynomial file
  const uploadUrl = `${apiUrl}/optimization/v1/files`;
  logInfo(reqId, "Uploading polynomial file to QCI", { url: uploadUrl });

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: polyJson,
  });

  const uploadText = await uploadResp.text();
  logInfo(reqId, "QCI upload response", {
    status: uploadResp.status,
    ok: uploadResp.ok,
    www_authenticate: uploadResp.headers.get("www-authenticate"),
    body_preview: trunc(uploadText, 600),
  });

  if (!uploadResp.ok) {
    throw new Error(`QCI file upload failed: ${uploadResp.status} - ${uploadText}`);
  }

  const uploadResult = safeJsonParse(uploadText);
  const fileId = uploadResult?.file_id;
  if (!fileId) {
    throw new Error(`QCI upload succeeded but returned unexpected body: ${trunc(uploadText, 600)}`);
  }

  logInfo(reqId, "Polynomial file uploaded", { file_id: fileId });

  // Step 2: Submit job
  const jobBody = {
    job_submission: {
      job_name: jobName,
      job_tags: ["kurtosis", "mvp", "allocator"],
      device_config: {
        "dirac-3_qudit": {
          num_samples: numSamples,
          relaxation_schedule: relaxationSchedule,
          num_levels: [2],
        },
      },
      problem_config: {
        qudit_hamiltonian_optimization: {
          polynomial_file_id: fileId,
        },
      },
    },
  };

  const jobUrl = `${apiUrl}/optimization/v1/jobs`;
  const jobJson = JSON.stringify(jobBody);

  logInfo(reqId, "Submitting DIRAC-3 job", {
    url: jobUrl,
    job_name: jobName,
    job_json_bytes: bytes(jobJson),
  });

  const jobResp = await fetch(jobUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: jobJson,
  });

  const jobText = await jobResp.text();
  logInfo(reqId, "QCI job submit response", {
    status: jobResp.status,
    ok: jobResp.ok,
    body_preview: trunc(jobText, 800),
  });

  if (!jobResp.ok) {
    throw new Error(`QCI job submission failed: ${jobResp.status} - ${jobText}`);
  }

  const jobResult = safeJsonParse(jobText) || {};
  const jobId =
    (jobResult as any)?.job_id ?? (jobResult as any)?.job?.job_id ?? (jobResult as any)?.job_submission?.job_id;

  if (!jobId) {
    throw new Error(`QCI job submission succeeded but returned unexpected body: ${trunc(jobText, 800)}`);
  }

  logInfo(reqId, "Job submitted successfully", { job_id: jobId, file_id: fileId });

  return { jobId, fileId };
}

// =============================================================================
// DIRAC-3 API Client - Check Job Status
// =============================================================================
async function checkDirac3JobStatus(
  jobId: string,
  reqId: string,
): Promise<{ status: string; results?: object; rawResponse?: object }> {
  const { apiUrl, authHeader } = await getQciAuth(reqId);

  const pollUrl = `${apiUrl}/optimization/v1/jobs/${jobId}`;
  logInfo(reqId, "Checking job status", { url: pollUrl, job_id: jobId });

  const pollResp = await fetch(pollUrl, {
    headers: { Authorization: authHeader },
  });

  const pollText = await pollResp.text();

  // Log full response for debugging
  logInfo(reqId, "QCI job status response", {
    http_status: pollResp.status,
    body_preview: trunc(pollText, 1500),
  });

  if (!pollResp.ok) {
    throw new Error(`QCI job status check failed: ${pollResp.status} - ${trunc(pollText, 600)}`);
  }

  const pollResult = safeJsonParse(pollText);

  // Try multiple possible paths for status
  const status =
    pollResult?.status ??
    pollResult?.job?.status ??
    pollResult?.job_info?.status ??
    pollResult?.data?.status ??
    pollResult?.job_status?.status ??
    "UNKNOWN";

  // Log all possible status paths for debugging
  logInfo(reqId, "Job status extraction", {
    job_id: jobId,
    "pollResult?.status": pollResult?.status,
    "pollResult?.job?.status": pollResult?.job?.status,
    "pollResult?.job_info?.status": pollResult?.job_info?.status,
    "pollResult?.data?.status": pollResult?.data?.status,
    "pollResult?.job_status?.status": pollResult?.job_status?.status,
    extracted_status: status,
    top_level_keys: pollResult ? Object.keys(pollResult) : [],
  });

  return {
    status,
    results: pollResult?.results ?? pollResult?.job?.results ?? pollResult?.data?.results,
    rawResponse: pollResult,
  };
}

// =============================================================================
// Decode Solution
// =============================================================================
function decodeArgmax(groups: Group[], solutionVec: number[]): Record<string, string> {
  const chosen: Record<string, string> = {};

  for (const g of groups) {
    const vals = g.var_indices.map((i) => solutionVec[i - 1]); // 1-based to 0-based
    let bestPos = 0;
    let bestVal = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] > bestVal) {
        bestVal = vals[i];
        bestPos = i;
      }
    }
    chosen[g.name] = g.keys[bestPos];
  }

  return chosen;
}

// =============================================================================
// Compute Score Breakdown
// =============================================================================
function computeBreakdown(
  pools: Pool[],
  hedges: Hedges,
  scenarios: Scenario[],
  scenarioId: string,
  chosen: Record<string, string>,
): object {
  const scenario = scenarios.find((s) => s.scenario_id === scenarioId)!;
  const mult = scenario.multipliers;
  const pool = pools.find((p) => p.pool_id === chosen["pool"])!;

  // Rewards
  const feeApr = pool.reward.fee_apr;
  const incApr = pool.reward.incentive_apr;
  const baseApr = pool.reward.base_apr;
  const grossApr = (feeApr + incApr + baseApr) * mult.reward_multiplier;

  // Size & rebalance
  const sizeKey = chosen["size"];
  const rebKey = chosen["rebalance"];
  const { notional: sizeNotional, mult: sizeMult } = getSizeNotionalAndMult(sizeKey);
  const { perWeek: rebPerWeek, mult: rebMult } = getRebParams(rebKey);

  // Hedge
  const hedgeKey = chosen["hedge"];
  const tenorKey = chosen["tenor"] || null;
  const { costApr: hCostApr, ilMult: hIlMult } = getHedgeParams(hedges, hedgeKey, pool.pool_id, tenorKey, sizeKey);

  // IL penalty
  const ilAprBase = pool.risk.il_risk_score * MODEL_CFG.IL_SCORE_TO_APR * mult.il_risk_multiplier;
  const ilPenaltyApr = ilAprBase * sizeMult * Math.pow(rebMult, 0.8) * hIlMult;

  // Execution drag
  const gasUsd = pool.execution.gas_cost_usd_per_rebalance * mult.gas_multiplier;
  const slippageBps = pool.execution.slippage_bps_per_rebalance * mult.slippage_multiplier;
  const mevScore = pool.execution.mev_risk_score * mult.mev_multiplier;
  const failProb = pool.execution.failure_prob_per_rebalance * mult.failure_multiplier;
  const liquidityUnwindUsd = pool.risk.liquidity_unwind_cost_usd;

  const gasAprPerReb = gasUsd / Math.max(sizeNotional, 1.0);
  const unwindApr = liquidityUnwindUsd / Math.max(sizeNotional, 1.0);
  const slippageAprPerReb = (slippageBps / 10000.0) * Math.pow(sizeMult, 1.2);
  const mevAprPerReb = mevScore * MODEL_CFG.MEV_SCORE_TO_APR * Math.pow(sizeMult, 1.1);
  const failAprPerReb = failProb * MODEL_CFG.FAIL_PROB_TO_APR * sizeMult;

  let execDragApr = (gasAprPerReb + slippageAprPerReb + mevAprPerReb + failAprPerReb) * rebPerWeek * 52.0 * rebMult;
  execDragApr += 0.1 * unwindApr;

  // Hedge overhead
  let hedgeOverheadApr = 0;
  if (hedgeKey !== "none") {
    hedgeOverheadApr = MODEL_CFG.HEDGE_EXTRA_GAS_MULTIPLIER * gasAprPerReb * rebPerWeek * 52.0;
  }

  const totalPenalties = ilPenaltyApr + hCostApr + execDragApr + hedgeOverheadApr;
  const netApr = grossApr - totalPenalties;

  return {
    rewards: {
      fee_apr: feeApr,
      incentive_apr: incApr,
      base_apr: baseApr,
      total_gross_apr: grossApr,
    },
    penalties_and_costs: {
      il_penalty_apr: ilPenaltyApr,
      hedge_cost_apr: hCostApr,
      execution_drag_apr: execDragApr,
      risk_penalty_apr: hedgeOverheadApr,
      total_costs_apr: totalPenalties,
    },
    net_apr: {
      estimated_net_apr: netApr,
    },
  };
}

// =============================================================================
// Compute Baseline (max gross APR, no hedge)
// =============================================================================
function computeBaseline(
  pools: Pool[],
  scenarios: Scenario[],
  scenarioId: string,
  chosen: Record<string, string>,
): Record<string, string> {
  const scenario = scenarios.find((s) => s.scenario_id === scenarioId)!;
  const mult = scenario.multipliers;

  let bestPool = pools[0];
  let bestGross = -Infinity;

  for (const p of pools) {
    const gross = (p.reward.fee_apr + p.reward.incentive_apr + p.reward.base_apr) * mult.reward_multiplier;
    if (gross > bestGross) {
      bestGross = gross;
      bestPool = p;
    }
  }

  return {
    ...chosen,
    pool: bestPool.pool_id,
    hedge: "none",
  };
}

// =============================================================================
// Process Job Results
// =============================================================================
function processJobResults(
  pools: Pool[],
  hedges: Hedges,
  scenarios: Scenario[],
  scenarioId: string,
  selectedBuckets: SelectedBuckets,
  groups: Group[],
  results: { energies: number[]; solutions: number[][]; counts?: number[] },
  scale: number,
  meta: object,
  requestBaseline: boolean,
  reqId: string,
): object {
  const energies: number[] = results.energies;
  const solutions: number[][] = results.solutions;
  const counts: number[] = results.counts || solutions.map(() => 1);

  logInfo(reqId, "Job results received", {
    energies: energies?.length ?? 0,
    solutions: solutions?.length ?? 0,
    counts: counts?.length ?? 0,
  });

  // Find best solution (lowest energy)
  let bestIdx = 0;
  for (let i = 1; i < energies.length; i++) {
    if (energies[i] < energies[bestIdx]) {
      bestIdx = i;
    }
  }

  const bestEnergy = energies[bestIdx];
  const bestSolution = solutions[bestIdx].map((v) => Math.round(v));

  // Decode solution
  const chosen = decodeArgmax(groups, bestSolution);

  // Add position info from input
  chosen["position_size_usd"] = selectedBuckets.position_size_usd.toString();
  if (!chosen["rebalance"]) {
    chosen["rebalance"] = selectedBuckets.rebalance_bucket;
  }
  if (!chosen["tenor"]) {
    chosen["tenor"] = selectedBuckets.tenor_bucket;
  }

  // Compute breakdowns
  const breakdown = computeBreakdown(pools, hedges, scenarios, scenarioId, chosen);

  // Compute baseline if requested
  let baselineData = null;
  if (requestBaseline) {
    const baselineChoice = computeBaseline(pools, scenarios, scenarioId, chosen);
    const baselineBreakdown = computeBreakdown(pools, hedges, scenarios, scenarioId, baselineChoice);
    const baselinePool = pools.find((p) => p.pool_id === baselineChoice["pool"])!;

    const optimizedNet = (breakdown as any).net_apr.estimated_net_apr;
    const baselineNet = (baselineBreakdown as any).net_apr.estimated_net_apr;

    baselineData = {
      baseline_pool_id: baselineChoice["pool"],
      baseline_pool_label: baselinePool.label,
      baseline_gross_apr: (baselineBreakdown as any).rewards.total_gross_apr,
      baseline_net_apr: baselineNet,
      optimized_net_apr: optimizedNet,
      delta_net_apr: optimizedNet - baselineNet,
      improvement_pct: baselineNet !== 0 ? ((optimizedNet - baselineNet) / Math.abs(baselineNet)) * 100 : 0,
    };
  }

  const pool = pools.find((p) => p.pool_id === chosen["pool"])!;

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    inputs_used: {
      scenario_id: scenarioId,
      selected_buckets: selectedBuckets,
    },
    decision: {
      pool_id: chosen["pool"],
      pool_label: pool.label,
      hedge_type: chosen["hedge"],
      tenor_bucket: chosen["tenor"] || selectedBuckets.tenor_bucket,
      position_size_usd: selectedBuckets.position_size_usd,
      rebalance_bucket: chosen["rebalance"] || selectedBuckets.rebalance_bucket,
    },
    score: {
      objective_value: bestEnergy,
      units: scale !== 1.0 ? "DIRAC energy (scaled)" : "DIRAC energy",
    },
    score_breakdown: breakdown,
    baseline_comparison: baselineData,
    explain_like_im_15: [
      "We picked the strategy with the best 'real outcome' after subtracting hidden costs.",
      "We penalize price-move risk (IL proxy) and real trading costs like gas and slippage.",
      "Adding a hedge can reduce big losses, but it also costs money and adds extra transactions.",
      "The baseline picks the highest headline APR with no hedge; our choice focuses on net result.",
    ],
    debug: {
      solver_type: "DIRAC-3",
      energies,
      counts,
      coef_rescale: scale,
      meta,
      request_id: reqId,
      chosen_binary_variables: Object.fromEntries(
        groups.flatMap((g) => g.keys.map((k, i) => [`${g.name}_${k}`, bestSolution[g.var_indices[i] - 1] === 1])),
      ),
    },
  };
}

// =============================================================================
// Main Handler
// =============================================================================
serve(async (req) => {
  const reqId = makeRequestId();
  const startedAt = Date.now();
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...corsHeaders, "x-request-id": reqId } });
  }

  logInfo(reqId, "Incoming request", {
    method: req.method,
    path: url.pathname,
    content_length: req.headers.get("content-length"),
    user_agent: req.headers.get("user-agent"),
  });

  try {
    const body: SolverRequest = await req.json();

    const {
      action = "submit", // default to submit for backward compatibility
      job_id,
      scenario_id,
      pools,
      hedges,
      scenarios,
      selected_buckets,
      request_baseline = true,
      num_samples = 1,
      relaxation_schedule = 1,
    } = body;

    logInfo(reqId, "Parsed request body", {
      action,
      job_id: job_id || null,
      scenario_id,
      pools: pools?.length ?? 0,
      pool_ids: (pools || []).map((p) => p.pool_id),
      selected_buckets,
      request_baseline,
      num_samples,
      relaxation_schedule,
    });

    // =======================================================================
    // ACTION: STATUS - Check job status and return results if complete
    // =======================================================================
    if (action === "status") {
      if (!job_id) {
        throw new Error("job_id is required for status action");
      }

      const { status, results, rawResponse } = await checkDirac3JobStatus(job_id, reqId);

      logInfo(reqId, "Status check result", { job_id, status });

      if (status === "COMPLETED" && results) {
        // Validate we have all required input data to process results
        if (!pools || pools.length < 3) {
          throw new Error("Need at least 3 pools to process results");
        }

        const scenario = scenarios.find((s) => s.scenario_id === scenario_id);
        if (!scenario) {
          throw new Error(`Scenario '${scenario_id}' not found`);
        }

        // Rebuild variable groups for decoding
        const { groups, gmap } = buildVariables(pools, hedges, scenarios);
        const { pb, meta } = buildEnergyPolynomial(pools, hedges, scenarios, scenario_id, groups, gmap);

        // Compute scale factor (for display purposes)
        const maxAbs = pb.getMaxAbsCoef();
        let scale = 1.0;
        if (maxAbs > MODEL_CFG.TARGET_MAX_COEF_ABS) {
          scale = maxAbs / MODEL_CFG.TARGET_MAX_COEF_ABS;
        }

        // Process results
        const result = processJobResults(
          pools,
          hedges,
          scenarios,
          scenario_id,
          selected_buckets,
          groups,
          results as any,
          scale,
          meta,
          request_baseline,
          reqId,
        );

        logInfo(reqId, "Job completed, results processed", {
          job_id,
          duration_ms: Date.now() - startedAt,
        });

        return new Response(
          JSON.stringify({
            action: "status",
            status: "COMPLETED",
            job_id,
            result,
            request_id: reqId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": reqId },
          },
        );
      }

      if (status === "FAILED") {
        return new Response(
          JSON.stringify({
            action: "status",
            status: "FAILED",
            job_id,
            error: "DIRAC-3 job failed",
            rawResponse,
            request_id: reqId,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": reqId },
          },
        );
      }

      // Job still running
      return new Response(
        JSON.stringify({
          action: "status",
          status: status || "RUNNING",
          job_id,
          message: "Job is still processing",
          request_id: reqId,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": reqId },
        },
      );
    }

    // =======================================================================
    // ACTION: SUBMIT - Submit job and return immediately
    // =======================================================================
    // Validate inputs
    if (!pools || pools.length < 3) {
      throw new Error("Need at least 3 pools");
    }

    const scenario = scenarios.find((s) => s.scenario_id === scenario_id);
    if (!scenario) {
      throw new Error(`Scenario '${scenario_id}' not found`);
    }

    // Build variables and polynomial
    const { groups, gmap } = buildVariables(pools, hedges, scenarios);
    logInfo(reqId, "Built variable groups", {
      groups: groups.map((g) => ({ name: g.name, count: g.keys.length })),
    });

    const { pb, meta } = buildEnergyPolynomial(pools, hedges, scenarios, scenario_id, groups, gmap);

    // Rescale coefficients if needed
    const maxAbs = pb.getMaxAbsCoef();
    let scale = 1.0;
    if (maxAbs > MODEL_CFG.TARGET_MAX_COEF_ABS) {
      scale = maxAbs / MODEL_CFG.TARGET_MAX_COEF_ABS;
      pb.rescale(scale);
    }

    logInfo(reqId, "Polynomial summary", {
      terms: pb.getTerms().size,
      max_abs_coef: maxAbs,
      coef_rescale: scale,
      meta,
    });

    const numVariables = groups.reduce((sum, g) => sum + g.keys.length, 0);
    logInfo(reqId, "Variable summary", { numVariables });

    // Submit job to DIRAC-3 (returns immediately, no polling)
    const { jobId, fileId } = await submitDirac3Job(
      pb,
      numVariables,
      num_samples,
      relaxation_schedule,
      `kurtosis_allocator_${scenario_id}`,
      reqId,
    );

    logInfo(reqId, "DIRAC-3 job submitted successfully", {
      job_id: jobId,
      file_id: fileId,
      duration_ms: Date.now() - startedAt,
    });

    return new Response(
      JSON.stringify({
        action: "submit",
        status: "SUBMITTED",
        job_id: jobId,
        file_id: fileId,
        message: "Job submitted to DIRAC-3. Poll with action='status' to get results.",
        request_id: reqId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": reqId },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError(reqId, "DIRAC-3 solver error", {
      message,
      duration_ms: Date.now() - startedAt,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(
      JSON.stringify({
        error: message,
        fallback: true, // Signal to client to use mock solver
        request_id: reqId,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": reqId },
      },
    );
  }
});
