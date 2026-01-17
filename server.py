
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import os
import sys

# Add current directory to path so we can import the solver
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from solverdirac3_optimize import run_optimization

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def load_data_files():
    """Load pools, hedges, and scenarios from data/ directory"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    
    with open(os.path.join(data_dir, "pools.json"), "r", encoding="utf-8") as f:
        pools_json = json.load(f)
    
    with open(os.path.join(data_dir, "hedges.json"), "r", encoding="utf-8") as f:
        hedges_json = json.load(f)
    
    with open(os.path.join(data_dir, "scenarios.json"), "r", encoding="utf-8") as f:
        scenarios_json = json.load(f)
    
    return pools_json, hedges_json, scenarios_json

class SelectedBuckets(BaseModel):
    position_size_usd: float
    rebalance_bucket: str
    tenor_bucket: str

class OptimizeRequest(BaseModel):
    scenario_id: str
    selected_buckets: SelectedBuckets
    num_samples: Optional[int] = 10
    relaxation_schedule: Optional[int] = 1
    use_mock: Optional[bool] = False

@app.post("/optimize")
async def optimize(request: OptimizeRequest):
    print("\n" + "="*80)
    print("[SERVER] 🚀 Received optimization request")
    print(f"[SERVER] Scenario: {request.scenario_id}")
    print(f"[SERVER] Position size: ${request.selected_buckets.position_size_usd:,.2f}")
    print(f"[SERVER] Rebalance: {request.selected_buckets.rebalance_bucket}")
    print(f"[SERVER] Tenor: {request.selected_buckets.tenor_bucket}")
    print(f"[SERVER] Mode: {'MOCK' if request.use_mock else 'DIRAC-3'}")
    print("="*80 + "\n")
    
    try:
        # Load system data from files
        print("[SERVER] 📂 Loading data from files...")
        pools_data, hedges_data, scenarios_data = load_data_files()
        
        # Extract pools list from the loaded data
        pools_list = pools_data.get("pools", pools_data) if isinstance(pools_data, dict) else pools_data
        print(f"[SERVER] ✓ Loaded {len(pools_list)} pools from data/pools.json")
        
        # Extract scenarios list from the loaded data
        scenarios_list = scenarios_data.get("scenarios", scenarios_data) if isinstance(scenarios_data, dict) else scenarios_data
        print(f"[SERVER] ✓ Loaded {len(scenarios_list)} scenarios from data/scenarios.json")
        print(f"[SERVER] ✓ Loaded hedges from data/hedges.json")
        
        # Create synthetic buckets config based on user input
        user_size_bucket = {
            "key": "UserSelected",
            "notional_usd": request.selected_buckets.position_size_usd,
            "multiplier": 1.0
        }
        
        rebalance_map = {
            "daily": {"key": "daily", "rebalance_per_week": 7, "multiplier": 1.8},
            "weekly": {"key": "weekly", "rebalance_per_week": 1, "multiplier": 1.0},
            "monthly": {"key": "monthly", "rebalance_per_week": 0.25, "multiplier": 0.8}
        }
        
        user_rebalance_bucket = rebalance_map.get(
            request.selected_buckets.rebalance_bucket, 
            {"key": request.selected_buckets.rebalance_bucket, "rebalance_per_week": 1, "multiplier": 1.0}
        )

        # Build pools_json with user-selected buckets
        pools_json = {
            "pools": pools_list,
            "buckets": {
                "size_buckets": [user_size_bucket],
                "rebalance_buckets": [user_rebalance_bucket]
            }
        }
        
        # Build scenarios_json
        scenarios_json = {
            "scenarios": scenarios_list
        }

        # Process hedges - ensure hedge_types is a list
        hedges_json = dict(hedges_data)
        print(f"[SERVER] 🔍 Processing hedges structure...")
        
        if 'hedge_types' in hedges_json and isinstance(hedges_json['hedge_types'], dict):
            hedge_types_list = []
            for key, value in hedges_json['hedge_types'].items():
                hedge_types_list.append({
                    "key": key,
                    "default_cost_apr": value.get('cost_apr', 0.0),
                    "default_il_multiplier": value.get('il_multiplier', 1.0),
                })
            hedges_json['hedge_types'] = hedge_types_list
            print(f"[SERVER] ✓ Transformed hedge_types: {len(hedge_types_list)} items")
        
        # Transform tenor_buckets if needed
        if 'tenor_buckets' in hedges_json:
            if isinstance(hedges_json['tenor_buckets'], dict):
                tenor_buckets_list = []
                for key, value in hedges_json['tenor_buckets'].items():
                    tenor_buckets_list.append({"key": key})
                hedges_json['tenor_buckets'] = tenor_buckets_list
                print(f"[SERVER] ✓ Transformed tenor_buckets from dict: {len(tenor_buckets_list)} items")
            elif isinstance(hedges_json['tenor_buckets'], list) and len(hedges_json['tenor_buckets']) > 0:
                # Check if it's a list of strings - if so, convert to list of dicts
                if isinstance(hedges_json['tenor_buckets'][0], str):
                    hedges_json['tenor_buckets'] = [{"key": t} for t in hedges_json['tenor_buckets']]
                    print(f"[SERVER] ✓ Transformed tenor_buckets from string list: {len(hedges_json['tenor_buckets'])} items")

        # Check if we should use mock mode or call DIRAC-3
        if request.use_mock:
            print(f"[SERVER] 📋 Using MOCK optimizer...")
            
            # Simple mock: pick pool with highest fee_apr, no hedge
            best_pool = max(pools_list, key=lambda p: p.get('reward', {}).get('fee_apr', 0))
            chosen = {
                "pool": best_pool["pool_id"],
                "hedge": "none",
                "size": "UserSelected",
                "rebalance": request.selected_buckets.rebalance_bucket,
                "tenor": request.selected_buckets.tenor_bucket
            }
            
            # Create mock result structure
            from datetime import datetime, timezone
            result = {
                "schema_version": "1.0",
                "as_of_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "inputs_used": {"scenario_id": request.scenario_id},
                "decision": {
                    "pool_id": chosen["pool"],
                    "pool_label": best_pool.get("label", best_pool["pool_id"]),
                    "hedge_type": "none",
                    "tenor_bucket": chosen["tenor"],
                    "size_bucket": "UserSelected",
                    "position_size_usd": request.selected_buckets.position_size_usd,
                    "rebalance_bucket": chosen["rebalance"],
                },
                "score": {
                    "objective_value": 0.0,
                    "units": "MOCK (not optimized)",
                    "notes": {"mode": "mock"}
                },
                "score_breakdown": {
                    "rewards": {
                        "fee_apr": best_pool.get('reward', {}).get('fee_apr', 0),
                        "incentive_apr": 0.0,
                        "base_apr": 0.0,
                        "total_gross_apr": best_pool.get('reward', {}).get('fee_apr', 0),
                    },
                    "penalties_and_costs": {
                        "il_penalty_apr": 0.02,
                        "hedge_cost_apr": 0.0,
                        "execution_drag_apr": 0.05,
                        "hedge_overhead_apr": 0.0,
                        "total_penalties_apr": 0.07,
                    },
                    "net_apr": {
                        "estimated_net_apr": best_pool.get('reward', {}).get('fee_apr', 0) - 0.07,
                    }
                },
                "baseline_comparison": {
                    "baseline_id": "MOCK_BASELINE",
                    "baseline_decision": chosen,
                    "baseline_score_breakdown": {},
                    "delta_vs_baseline": {"net_apr_improvement": 0.0}
                },
                "explain_like_im_15": [
                    "This is a MOCK result (not optimized by DIRAC-3).",
                    "We just picked the pool with the highest fee APR.",
                    "For real optimization, enable DIRAC-3 mode."
                ],
                "debug": {
                    "mode": "mock",
                    "reason": "use_mock parameter was set to true"
                }
            }
        else:
            print(f"[SERVER] 📊 Calling DIRAC-3 optimizer...")
            
            result = run_optimization(
                pools_json=pools_json,
                hedges_json=hedges_json,
                scenarios_json=scenarios_json,
                scenario_id=request.scenario_id,
                num_samples=request.num_samples,
                relaxation_schedule=request.relaxation_schedule
            )
            
            # Inject the actual position size into the decision
            if "decision" in result:
                result["decision"]["position_size_usd"] = request.selected_buckets.position_size_usd

        print(result)
        
        print(f"[SERVER] ✅ Optimization complete!")
        print(f"[SERVER] Chosen pool: {result['decision']['pool_id']}")
        print(f"[SERVER] Chosen hedge: {result['decision']['hedge_type']}")
        print(f"[SERVER] Net APR: {result['score_breakdown']['net_apr']['estimated_net_apr']:.4f}")
        print("\n" + "="*80 + "\n")
        
        return result

    except Exception as e:
        print(f"\n[SERVER] ❌ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        print("="*80 + "\n")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
