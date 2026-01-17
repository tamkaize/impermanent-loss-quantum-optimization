"""Build scenario multipliers based on market conditions."""
import json
from typing import Dict


class ScenarioBuilder:
    """Builds market scenario configurations."""
    
    # Pre-defined scenarios
    SCENARIOS = {
        "CALM": {
            "label": "Calm market (low costs, lower risk)",
            "notes": "Low volatility, normal gas prices, stable conditions",
            "multipliers": {
                "reward_multiplier": 1.0,
                "il_risk_multiplier": 0.8,
                "gas_multiplier": 0.8,
                "slippage_multiplier": 0.8,
                "mev_multiplier": 0.7,
                "failure_multiplier": 0.7
            }
        },
        "CHAOTIC": {
            "label": "Chaotic market (high costs, higher risk)",
            "notes": "High volatility, elevated gas, increased MEV/slippage",
            "multipliers": {
                "reward_multiplier": 1.0,  # Rewards don't increase
                "il_risk_multiplier": 1.6,  # IL risk 60% higher
                "gas_multiplier": 1.8,      # Gas 80% higher
                "slippage_multiplier": 1.6,  # Slippage 60% higher
                "mev_multiplier": 1.8,      # MEV 80% higher
                "failure_multiplier": 1.5   # 50% more failures
            }
        }
    }
    
    # Rebalance frequency interactions
    REBALANCE_INTERACTION = {
        "daily": {
            "extra_gas_multiplier": 1.3,
            "extra_failure_multiplier": 1.2,
            "notes": "Daily rebalancing amplifies costs"
        },
        "weekly": {
            "extra_gas_multiplier": 1.0,
            "extra_failure_multiplier": 1.0,
        },
    }
    
    def __init__(self):
        """Initialize scenario builder."""
        pass
    
    def get_scenario(self, scenario_id: str) -> Dict:
        """
        Get scenario configuration.
        
        Args:
            scenario_id: Scenario identifier (CALM, CHAOTIC)
            
        Returns:
            Scenario dictionary
        """
        scenario = self.SCENARIOS.get(scenario_id)
        if not scenario:
            raise ValueError(f"Unknown scenario: {scenario_id}")
        
        return {
            "scenario_id": scenario_id,
            **scenario
        }
    
    def calculate_adjusted_cost(
        self,
        base_cost: float,
        scenario_id: str,
        cost_type: str,
        rebalance_frequency: str = "weekly"
    ) -> float:
        """
        Calculate adjusted cost based on scenario.
        
        Args:
            base_cost: Base cost value
            scenario_id: Scenario to apply
            cost_type: Type of cost (gas, slippage, mev, failure)
            rebalance_frequency: Rebalance frequency (daily, weekly)
            
        Returns:
            Adjusted cost
        """
        scenario = self.get_scenario(scenario_id)
        multipliers = scenario["multipliers"]
        
        # Get scenario multiplier
        multiplier_key = f"{cost_type}_multiplier"
        scenario_mult = multipliers.get(multiplier_key, 1.0)
        
        # Apply rebalance interaction for gas and failure
        rebalance_config = self.REBALANCE_INTERACTION.get(rebalance_frequency, {})
        
        if cost_type == "gas":
            scenario_mult *= rebalance_config.get("extra_gas_multiplier", 1.0)
        elif cost_type == "failure":
            scenario_mult *= rebalance_config.get("extra_failure_multiplier", 1.0)
        
        return base_cost * scenario_mult
    
    def export_scenarios_json(self) -> Dict:
        """
        Export scenarios in JSON format matching our schema.
        
        Returns:
            Scenarios dictionary for JSON export
        """
        return {
            "schema_version": "1.0",
            "as_of_utc": "2026-01-17T00:00:00Z",
            "units": {
                "multiplier": "dimensionless"
            },
            "scenarios": [
                {
                    "scenario_id": scenario_id,
                    **config
                }
                for scenario_id, config in self.SCENARIOS.items()
            ],
            "rebalance_interaction": self.REBALANCE_INTERACTION
        }


def main():
    """Test the scenario builder."""
    print("=== Testing Scenario Builder ===\n")
    
    builder = ScenarioBuilder()
    
    # Display all scenarios
    for scenario_id in ["CALM", "CHAOTIC"]:
        scenario = builder.get_scenario(scenario_id)
        print(f"=== {scenario_id} ===")
        print(f"Label: {scenario['label']}")
        print(f"Description: {scenario['notes']}\n")
        
        print("Multipliers:")
        for key, value in scenario["multipliers"].items():
            print(f"  {key}: {value:.2f}")
        print()
    
    # Test cost adjustments
    print("=== Cost Adjustments Example ===")
    print("Base Gas Cost: $10.00\n")
    
    base_gas = 10.0
    
    for scenario_id in ["CALM", "CHAOTIC"]:
        for rebalance in ["weekly", "daily"]:
            adjusted = builder.calculate_adjusted_cost(
                base_cost=base_gas,
                scenario_id=scenario_id,
                cost_type="gas",
                rebalance_frequency=rebalance
            )
            
            print(f"{scenario_id} + {rebalance}: ${adjusted:.2f}")
    
    # Export JSON
    print("\n=== Exported JSON Structure ===")
    export = builder.export_scenarios_json()
    print(json.dumps(export, indent=2))


if __name__ == "__main__":
    main()
