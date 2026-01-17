
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

class SelectedBuckets(BaseModel):
    position_size_usd: float
    rebalance_bucket: str
    tenor_bucket: str

class OptimizeRequest(BaseModel):
    scenario_id: str
    pools: List[Dict[str, Any]]
    hedges: Dict[str, Any]  # The entire hedges.json content
    scenarios: List[Dict[str, Any]] # The scenarios list
    selected_buckets: SelectedBuckets
    num_samples: Optional[int] = 10
    relaxation_schedule: Optional[int] = 1

@app.post("/optimize")
async def optimize(request: OptimizeRequest):
    print("\n" + "="*80)
    print("[SERVER] 🚀 Received optimization request")
    print(f"[SERVER] Scenario: {request.scenario_id}")
    print(f"[SERVER] Position size: ${request.selected_buckets.position_size_usd:,.2f}")
    print(f"[SERVER] Rebalance: {request.selected_buckets.rebalance_bucket}")
    print(f"[SERVER] Tenor: {request.selected_buckets.tenor_bucket}")
    print(f"[SERVER] Number of pools: {len(request.pools)}")
    print("="*80 + "\n")
    
    try:
        # We'll create a synthetic buckets config
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

        pools_json = {
            "pools": request.pools,
            "buckets": {
                "size_buckets": [user_size_bucket],
                "rebalance_buckets": [user_rebalance_bucket]
            }
        }
        
        scenarios_json = {
            "scenarios": request.scenarios
        }

        # Transform hedges - frontend sends hedge_types as dict, optimizer expects list
        hedges_json = dict(request.hedges)
        print(f"[SERVER] 🔍 Transforming hedges structure...")
        
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
        
        # Also transform tenor_buckets if it exists and needs transformation
        if 'tenor_buckets' in hedges_json:
            print(f"[SERVER] 🔍 tenor_buckets type: {type(hedges_json['tenor_buckets'])}")
            print(f"[SERVER] 🔍 tenor_buckets value: {hedges_json['tenor_buckets']}")
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
        else:
            print(f"[SERVER] ⚠️ No tenor_buckets in hedges, will use defaults")

        print(f"[SERVER] 📊 Calling DIRAC-3 optimizer...")
        
        result = run_optimization(
            pools_json=pools_json,
            hedges_json=hedges_json,
            scenarios_json=scenarios_json,
            scenario_id=request.scenario_id,
            num_samples=request.num_samples,
            relaxation_schedule=request.relaxation_schedule
        )
        
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
