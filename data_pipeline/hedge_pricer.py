"""Price hedge options using Black-Scholes model."""
import math
import time
from typing import Dict
from scipy.stats import norm


class HedgePricer:
    """Prices protective puts and collars for hedging strategies."""
    
    # Default implied volatilities (annualized)
    DEFAULT_IV = {
        "ETH": 0.60,  # 60% IV for ETH
        "BTC": 0.50,  # 50% IV for BTC
    }
    
    # Risk-free rate (approximate US Treasury rate)
    RISK_FREE_RATE = 0.04  # 4% annual
    
    def __init__(self):
        """Initialize hedge pricer."""
        self.cache = {}
    
    def black_scholes_put(
        self,
        spot_price: float,
        strike_price: float,
        time_to_expiry_days: int,
        volatility: float,
        risk_free_rate: float = None
    ) -> float:
        """
        Calculate put option price using Black-Scholes model.
        
        Args:
            spot_price: Current price of underlying
            strike_price: Strike price of option
            time_to_expiry_days: Days until expiration
            volatility: Implied volatility (annualized, decimal)
            risk_free_rate: Risk-free rate (annualized, decimal)
            
        Returns:
            Put option price
        """
        if risk_free_rate is None:
            risk_free_rate = self.RISK_FREE_RATE
        
        # Convert days to years
        T = time_to_expiry_days / 365.0
        
        if T <= 0:
            # Expired option
            return max(strike_price - spot_price, 0)
        
        # Black-Scholes formula components
        d1 = (math.log(spot_price / strike_price) + 
              (risk_free_rate + 0.5 * volatility ** 2) * T) / (volatility * math.sqrt(T))
        d2 = d1 - volatility * math.sqrt(T)
        
        # Put price
        put_price = (strike_price * math.exp(-risk_free_rate * T) * norm.cdf(-d2) -
                     spot_price * norm.cdf(-d1))
        
        return put_price
    
    def calculate_protective_put_cost(
        self,
        spot_price: float,
        position_size_usd: float,
        tenor_days: int,
        volatility: float,
        moneyness: float = 1.0  # 1.0 = ATM, 0.95 = 5% OTM
    ) -> Dict[str, float]:
        """
        Calculate cost of protective put hedge.
        
        Args:
            spot_price: Current price of underlying
            position_size_usd: Size of position to hedge
            tenor_days: Days until expiration
            volatility: Implied volatility
            moneyness: Strike relative to spot (1.0 = ATM)
            
        Returns:
            Dictionary with cost metrics
        """
        strike = spot_price * moneyness
        
        # Calculate put price per unit
        put_price_per_unit = self.black_scholes_put(
            spot_price=spot_price,
            strike_price=strike,
            time_to_expiry_days=tenor_days,
            volatility=volatility
        )
        
        # Calculate total cost
        units_to_hedge = position_size_usd / spot_price
        total_cost = put_price_per_unit * units_to_hedge
        
        # Annualize cost for APR comparison
        cost_apr = (total_cost / position_size_usd) * (365 / tenor_days)
        
        # Protection effectiveness (closer to ATM = better protection)
        protection_multiplier = 0.60 if moneyness >= 0.98 else 0.70
        
        return {
            "total_cost_usd": total_cost,
            "cost_apr": cost_apr,
            "protection_multiplier": protection_multiplier,
            "strike": strike,
            "put_price_per_unit": put_price_per_unit
        }
    
    def calculate_collar_cost(
        self,
        spot_price: float,
        position_size_usd: float,
        tenor_days: int,
        volatility: float,
        put_moneyness: float = 0.95,  # Buy 5% OTM put
        call_moneyness: float = 1.10  # Sell 10% OTM call
    ) -> Dict[str, float]:
        """
        Calculate cost of collar hedge (buy put, sell call).
        
        Args:
            spot_price: Current price of underlying
            position_size_usd: Size of position to hedge
            tenor_days: Days until expiration
            volatility: Implied volatility
            put_moneyness: Strike for put relative to spot
            call_moneyness: Strike for call relative to spot
            
        Returns:
            Dictionary with cost metrics
        """
        # Calculate put cost
        put_metrics = self.calculate_protective_put_cost(
            spot_price=spot_price,
            position_size_usd=position_size_usd,
            tenor_days=tenor_days,
            volatility=volatility,
            moneyness=put_moneyness
        )
        
        # Approximate call price (simplified - call ≈ more expensive than put for same strike)
        # For collar, we sell OTM call which is cheaper
        call_strike = spot_price * call_moneyness
        
        # Use put-call parity approximation for simplicity
        # Call price ≈ Put price + (Spot - Strike * discount)
        T = tenor_days / 365.0
        discount = math.exp(-self.RISK_FREE_RATE * T)
        
        # Simplified call price (this is an approximation)
        call_price_per_unit = max(
            put_metrics["put_price_per_unit"] * 0.6,  # OTM call cheaper than ATM put
            spot_price - call_strike * discount
        )
        
        units = position_size_usd / spot_price
        call_premium_received = call_price_per_unit * units
        
        # Net cost = put cost - call premium
        net_cost = put_metrics["total_cost_usd"] - call_premium_received
        cost_apr = (net_cost / position_size_usd) * (365 / tenor_days)
        
        # Collar provides less protection than pure put (capped upside)
        protection_multiplier = 0.80
        
        return {
            "total_cost_usd": net_cost,
            "cost_apr": cost_apr,
            "protection_multiplier": protection_multiplier,
            "put_strike": put_metrics["strike"],
            "call_strike": call_strike,
            "put_cost": put_metrics["total_cost_usd"],
            "call_premium": call_premium_received
        }
    
    def price_hedge_strategy(
        self,
        asset: str,
        hedge_type: str,
        tenor_days: int,
        position_size_usd: float = 5000,
        spot_price: float = None
    ) -> Dict[str, float]:
        """
        Price a hedge strategy.
        
        Args:
            asset: Asset to hedge (ETH, BTC)
            hedge_type: Type of hedge (protective_put, collar, none)
            tenor_days: Days until expiration
            position_size_usd: Position size in USD
            spot_price: Current price (if None, uses default)
            
        Returns:
            Dictionary with hedge metrics
        """
        # Default prices (approximate as of 2026)
        if spot_price is None:
            spot_price = 3500 if asset == "ETH" else 65000
        
        volatility = self.DEFAULT_IV.get(asset, 0.60)
        
        if hedge_type == "none":
            return {
                "cost_apr": 0.0,
                "protection_multiplier": 1.0,  # No protection
                "total_cost_usd": 0.0
            }
        
        elif hedge_type == "protective_put":
            return self.calculate_protective_put_cost(
                spot_price=spot_price,
                position_size_usd=position_size_usd,
                tenor_days=tenor_days,
                volatility=volatility
            )
        
        elif hedge_type == "collar":
            return self.calculate_collar_cost(
                spot_price=spot_price,
                position_size_usd=position_size_usd,
                tenor_days=tenor_days,
                volatility=volatility
            )
        
        else:
            raise ValueError(f"Unknown hedge type: {hedge_type}")
    
    def get_hedge_matrix(self) -> Dict:
        """
        Generate hedge pricing matrix for all combinations.
        
        Returns:
            Dictionary with hedge prices for all types and tenors
        """
        hedge_types = ["none", "protective_put", "collar"]
        tenors = [7, 14, 30]  # days
        
        matrix = {}
        
        for hedge_type in hedge_types:
            matrix[hedge_type] = {}
            for tenor in tenors:
                key = f"{tenor}D"
                pricing = self.price_hedge_strategy(
                    asset="ETH",
                    hedge_type=hedge_type,
                    tenor_days=tenor
                )
                matrix[hedge_type][key] = {
                    "cost_apr": pricing["cost_apr"],
                    "il_multiplier": pricing["protection_multiplier"]
                }
        
        return matrix


def main():
    """Test the hedge pricer."""
    print("=== Testing Hedge Pricer ===\n")
    
    pricer = HedgePricer()
    
    # Test individual strategies
    position_size = 5000  # $5,000 position
    
    print("Position Size: $5,000")
    print("Asset: ETH @ $3,500")
    print("Implied Volatility: 60%\n")
    
    for tenor in [7, 14, 30]:
        print(f"=== {tenor}-Day Tenor ===")
        
        for hedge_type in ["none", "protective_put", "collar"]:
            result = pricer.price_hedge_strategy(
                asset="ETH",
                hedge_type=hedge_type,
                tenor_days=tenor,
                position_size_usd=position_size
            )
            
            print(f"\n{hedge_type.replace('_', ' ').title()}:")
            print(f"  Cost: ${result['total_cost_usd']:.2f}")
            print(f"  Cost APR: {result['cost_apr']*100:.2f}%")
            print(f"  Protection: {(1-result['protection_multiplier'])*100:.1f}% IL reduction")
            
            if hedge_type == "collar":
                print(f"  Put Strike: ${result.get('put_strike', 0):.0f}")
                print(f"  Call Strike: ${result.get('call_strike', 0):.0f}")
        
        print()
    
    # Generate full matrix
    print("\n=== Hedge Pricing Matrix ===")
    matrix = pricer.get_hedge_matrix()
    
    for hedge_type, tenors in matrix.items():
        print(f"\n{hedge_type.replace('_', ' ').title()}:")
        for tenor, price in tenors.items():
            print(f"  {tenor}: Cost={price['cost_apr']*100:.2f}%, Protection={price['il_multiplier']:.2f}")


if __name__ == "__main__":
    main()
