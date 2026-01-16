"""Orchestration script to run all data fetchers and update JSON files."""
import json
import os
from pathlib import Path
from typing import Dict

from data_pipeline.gas_fetcher import GasFetcher
from data_pipeline.apy_fetcher import APYFetcher
from data_pipeline.hedge_pricer import HedgePricer
from data_pipeline.scenario_builder import ScenarioBuilder


class DataPipelineRunner:
    """Orchestrates all data fetchers and updates JSON files."""
    
    def __init__(self, data_dir: str = "data"):
        """
        Initialize pipeline runner.
        
        Args:
            data_dir: Directory containing JSON data files
        """
        self.data_dir = Path(data_dir)
        self.gas_fetcher = GasFetcher()
        self.apy_fetcher = APYFetcher()
        self.hedge_pricer = HedgePricer()
        self.scenario_builder = ScenarioBuilder()
        
        # ETH price for gas cost calculations (fetch from API in production)
        self.eth_price_usd = 3500
    
    def load_json(self, filename: str) -> Dict:
        """Load JSON file."""
        filepath = self.data_dir / filename
        if not filepath.exists():
            print(f"[Warning] File not found: {filepath}")
            return {}
        
        with open(filepath, 'r') as f:
            return json.load(f)
    
    def save_json(self, filename: str, data: Dict):
        """Save JSON file with pretty formatting."""
        filepath = self.data_dir / filename
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"[Saved] {filepath}")
    
    def update_pools_json(self):
        """Update pools.json with fresh data."""
        print("\n=== Updating pools.json ===")
        
        # Load existing pools.json
        pools_data = self.load_json("pools.json")
        
        # Fetch gas prices
        gas_prices = self.gas_fetcher.fetch_all_chains()
        
        # Fetch APY metrics
        apy_metrics = self.apy_fetcher.get_all_pool_metrics()
        
        # Map chains to gas prices for pool updates
        chain_gas_map = {
            "ethereum": gas_prices.get("ethereum", {}),
            "arbitrum": gas_prices.get("arbitrum", {}),
            "polygon": gas_prices.get("polygon", {})
        }
        
        # Estimated gas units for different operations
        gas_units = {
            "lp": 200000,     # LP deposit/withdrawal
            "lending": 100000  # Lending deposit
        }
        
        # Update each pool
        for pool in pools_data.get("pools", []):
            pool_id = pool["pool_id"]
            chain = pool.get("chain", "ethereum")
            strategy_type = pool.get("strategy_type", "lp")
            
            # Get APY metrics for this pool
            metrics = apy_metrics.get(pool_id, {})
            
            # Update rewards
            pool["reward"]["fee_apr"] = metrics.get("fee_apr", 0)
            pool["reward"]["incentive_apr"] = metrics.get("incentive_apr", 0)
            pool["reward"]["base_apr"] = 0.0  # Keep at 0 for now
            
            # Update TVL
            pool["tvl_usd"] = metrics.get("tvl_usd", 0)
            
            # Update risk metrics
            pool["risk"]["il_risk_score"] = metrics.get("il_risk_score", 0)
            pool["risk"]["price_vol_score"] = metrics.get("il_risk_score", 0)  # Use same for simplicity
            pool["risk"]["liquidity_unwind_cost_usd"] = min(500, metrics.get("tvl_usd", 0) * 0.001)
            
            # Update execution costs based on gas
            chain_gas = chain_gas_map.get(chain.lower(), {})
            gas_gwei = chain_gas.get("propose", 20.0)
            
            # Calculate gas cost per rebalance
            gas_cost_usd = self.gas_fetcher.calculate_gas_cost_usd(
                gas_gwei=gas_gwei,
                gas_units=gas_units.get(strategy_type, 200000),
                eth_price_usd=self.eth_price_usd
            )
            
            pool["execution"]["gas_cost_usd_per_rebalance"] = gas_cost_usd
            pool["execution"]["slippage_bps_per_rebalance"] = 10 if strategy_type == "lp" else 5
            pool["execution"]["mev_risk_score"] = 0.02 if chain == "ethereum" else 0.005
            pool["execution"]["failure_prob_per_rebalance"] = 0.01
            
            # Update data sources
            pool["data_sources"]["reward"] = metrics.get("source", "fallback")
            pool["data_sources"]["tvl"] = metrics.get("source", "fallback")
            pool["data_sources"]["gas"] = "etherscan" if not chain_gas.get("fallback") else "fallback"
            
            # Mark as using real data if not fallback
            pool["stubs_ok"] = metrics.get("source") == "fallback"
            
            print(f"  Updated {pool_id}: APY={pool['reward']['fee_apr']*100:.2f}%, Gas=${gas_cost_usd:.2f}")
        
        # Save updated pools.json
        self.save_json("pools.json", pools_data)
    
    def update_hedges_json(self):
        """Update hedges.json with calculated hedge prices."""
        print("\n=== Updating hedges.json ===")
        
        # Load existing hedges.json
        hedges_data = self.load_json("hedges.json")
        
        # Update hedge types with calculated prices
        hedge_matrix = self.hedge_pricer.get_hedge_matrix()
        
        for hedge_type_config in hedges_data.get("hedge_types", []):
            key = hedge_type_config["key"]
            
            if key in hedge_matrix:
                # Average across tenors for default
                tenor_prices = hedge_matrix[key]
                avg_cost = sum(p["cost_apr"] for p in tenor_prices.values()) / len(tenor_prices)
                avg_protection = sum(p["il_multiplier"] for p in tenor_prices.values()) / len(tenor_prices)
                
                hedge_type_config["default_cost_apr"] = avg_cost
                hedge_type_config["default_il_multiplier"] = avg_protection
                
                print(f"  Updated {key}: Cost={avg_cost*100:.2f}%, Protection={avg_protection:.2f}")
        
        # Update pool-specific overrides for POOL_1
        if hedges_data.get("pool_overrides"):
            for override in hedges_data["pool_overrides"]:
                if override["pool_id"] == "POOL_1":
                    for tenor_key, hedge_prices in hedge_matrix.items():
                        for tenor_days, tenor_label in [("7D", 7), ("14D", 14), ("30D", 30)]:
                            if tenor_days in override.get("tenor_overrides", {}):
                                if hedge_prices.get(tenor_days):
                                    override["tenor_overrides"][tenor_days][tenor_key] = {
                                        "cost_apr": hedge_prices[tenor_days]["cost_apr"],
                                        "il_multiplier": hedge_prices[tenor_days]["il_multiplier"]
                                    }
        
        # Save updated hedges.json
        self.save_json("hedges.json", hedges_data)
    
    def update_scenarios_json(self):
        """Update scenarios.json with current market conditions."""
        print("\n=== Updating scenarios.json ===")
        
        # Export scenarios from builder
        scenarios_data = self.scenario_builder.export_scenarios_json()
        
        # Save scenarios.json
        self.save_json("scenarios.json", scenarios_data)
        
        for scenario in scenarios_data["scenarios"]:
            print(f"  Updated {scenario['scenario_id']}: {scenario['label']}")
    
    def run_all(self):
        """Run all data pipeline steps."""
        print("=" * 60)
        print("=== Starting Data Pipeline ===")
        print("=" * 60)
        
        try:
            # Step 1: Update pools
            self.update_pools_json()
            
            # Step 2: Update hedges
            self.update_hedges_json()
            
            # Step 3: Update scenarios
            self.update_scenarios_json()
            
            print("\n" + "=" * 60)
            print("=== Data Pipeline Complete ===")
            print("=" * 60)
            print("\nAll JSON files have been updated successfully!")
            
        except Exception as e:
            print(f"\n[ERROR] Pipeline failed: {e}")
            import traceback
            traceback.print_exc()


def main():
    """Main entry point."""
    runner = DataPipelineRunner()
    runner.run_all()


if __name__ == "__main__":
    main()
