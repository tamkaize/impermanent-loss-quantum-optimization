"""Fetch DeFi yield/APY data from DefiLlama."""
import json
import time
from typing import Dict, List, Optional
import requests


class APYFetcher:
    """Fetches APY and pool data from DefiLlama."""
    
    BASE_URL = "https://yields.llama.fi/"
    
    # Pool mapping: our pool IDs to search criteria
    POOL_MAPPINGS = {
        "POOL_1": {
            "chain": "Ethereum",
            "token": "USDC",
            "protocol": "uniswap-v3",
            "label": "UniswapV3 ETH/USDC 0.05%"
        },
        "POOL_2": {
            "chain": "Arbitrum",
            "token": "WBTC",
            "protocol": "uniswap-v3",
            "label": "UniswapV3 WBTC/ETH 0.30%"
        },
        "POOL_3": {
            "chain": "Ethereum",
            "token": "USDC",
            "protocol": "curve",
            "label": "Stable LP USDC/USDT"
        },
        "POOL_4": {
            "chain": "Arbitrum",
            "token": "USDC",
            "protocol": "aave-v3",
            "label": "Lending USDC (safer baseline)"
        },
        "POOL_5": {
            "chain": None,  # Search all chains for high yield
            "min_apy": 50.0,  # Looking for >50% APY
            "label": "Volatile LP (high reward, high risk)"
        }
    }
    
    def __init__(self, cache_ttl: int = 600):
        """Initialize APY fetcher with cache TTL in seconds."""
        self.cache_ttl = cache_ttl
        self.pools_cache = None
        self.cache_timestamp = 0
        
    def fetch_all_pools(self, force_refresh: bool = False) -> List[Dict]:
        """
        Fetch all pools from DefiLlama yields API.
        
        Args:
            force_refresh: If True, bypass cache
            
        Returns:
            List of pool dictionaries
        """
        # Check cache
        if not force_refresh and self.pools_cache:
            if time.time() - self.cache_timestamp < self.cache_ttl:
                print("[APYFetcher] Using cached pools data")
                return self.pools_cache
        
        try:
            url = f"{self.BASE_URL}/pools"
            print(f"[APYFetcher] Fetching pools from {url}")
            
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            pools = data.get("data", [])
            
            # Cache the result
            self.pools_cache = pools
            self.cache_timestamp = time.time()
            
            print(f"[APYFetcher] Fetched {len(pools)} pools")
            return pools
            
        except Exception as e:
            print(f"[APYFetcher] Error fetching pools: {e}")
            # Return cache if available, otherwise empty list
            return self.pools_cache if self.pools_cache else []
    
    def find_pool(
        self, 
        chain: Optional[str] = None,
        token: Optional[str] = None,
        protocol: Optional[str] = None,
        min_apy: Optional[float] = None,
        min_tvl: float = 100000  # Minimum $100k TVL for liquidity
    ) -> Optional[Dict]:
        """
        Find a pool matching criteria.
        
        Args:
            chain: Chain name to filter
            token: Token symbol to filter
            protocol: Protocol name to filter
            min_apy: Minimum APY threshold
            min_tvl: Minimum TVL in USD
            
        Returns:
            Best matching pool or None
        """
        all_pools = self.fetch_all_pools()
        
        matching_pools = []
        for pool in all_pools:
            # Skip low liquidity pools
            if pool.get("tvlUsd", 0) < min_tvl:
                continue
            
            # Apply filters
            if chain and pool.get("chain") != chain:
                continue
            
            if token:
                symbol = pool.get("symbol", "")
                if token.upper() not in symbol.upper():
                    continue
            
            if protocol:
                project = pool.get("project", "")
                if protocol.lower() not in project.lower():
                    continue
            
            if min_apy:
                apy = pool.get("apy", 0)
                if apy < min_apy:
                    continue
            
            matching_pools.append(pool)
        
        if not matching_pools:
            print(f"[APYFetcher] No pools found for filters: chain={chain}, token={token}, protocol={protocol}")
            return None
        
        # Sort by APY and return best
        matching_pools.sort(key=lambda p: p.get("apy", 0), reverse=True)
        return matching_pools[0]
    
    def get_pool_metrics(self, pool_id: str) -> Dict:
        """
        Get metrics for a specific pool ID from our mapping.
        
        Args:
            pool_id: Our internal pool ID (e.g., "POOL_1")
            
        Returns:
            Dictionary with pool metrics or fallback values
        """
        mapping = self.POOL_MAPPINGS.get(pool_id)
        if not mapping:
            print(f"[APYFetcher] Unknown pool ID: {pool_id}")
            return self._fallback_metrics(pool_id)
        
        # Find pool from DefiLlama
        pool = self.find_pool(
            chain=mapping.get("chain"),
            token=mapping.get("token"),
            protocol=mapping.get("protocol"),
            min_apy=mapping.get("min_apy")
        )
        
        if not pool:
            print(f"[APYFetcher] Using fallback for {pool_id}")
            return self._fallback_metrics(pool_id)
        
        # Extract metrics (handle None values)
        apy = (pool.get("apy") or 0) / 100  # Convert percentage to decimal
        apy_base = (pool.get("apyBase") or 0) / 100
        apy_reward = (pool.get("apyReward") or 0) / 100
        tvl = pool.get("tvlUsd", 0)
        
        # Calculate IL risk proxy (higher volatility = higher IL risk)
        # Strategy: Use multiple signals to estimate risk
        if apy_reward > 0:
            # High reward APY suggests protocol is paying to attract liquidity = risky pool
            il_risk = min(apy_reward * 2, 0.15)
        elif apy > 0.5:  # Total APY > 50%
            # Very high APY without tracked rewards suggests volatile/risky pool
            il_risk = min(apy * 0.15, 0.12)
        elif apy > 0.2:  # APY > 20%
            # Moderately high APY = moderate risk
            il_risk = 0.05
        else:
            # Low/normal APY = baseline risk
            il_risk = 0.02
        
        metrics = {
            "pool_id": pool_id,
            "label": mapping["label"],
            "fee_apr": apy_base,
            "incentive_apr": apy_reward,
            "total_apy": apy,
            "tvl_usd": tvl,
            "il_risk_score": il_risk,
            "source": "defillama",
            "pool_key": pool.get("pool", ""),
            "chain": pool.get("chain", ""),
            "project": pool.get("project", "")
        }
        
        print(f"[APYFetcher] {pool_id}: APY={apy*100:.2f}%, TVL=${tvl:,.0f}")
        return metrics
    
    def _fallback_metrics(self, pool_id: str) -> Dict:
        """Return fallback metrics when API fails."""
        # Reasonable fallback values
        fallbacks = {
            "POOL_1": {"fee_apr": 0.08, "incentive_apr": 0.02, "tvl_usd": 50000000, "il_risk": 0.05},
            "POOL_2": {"fee_apr": 0.12, "incentive_apr": 0.03, "tvl_usd": 30000000, "il_risk": 0.08},
            "POOL_3": {"fee_apr": 0.04, "incentive_apr": 0.01, "tvl_usd": 100000000, "il_risk": 0.01},
            "POOL_4": {"fee_apr": 0.03, "incentive_apr": 0.01, "tvl_usd": 200000000, "il_risk": 0.005},
            "POOL_5": {"fee_apr": 0.50, "incentive_apr": 0.30, "tvl_usd": 5000000, "il_risk": 0.20},
        }
        
        fb = fallbacks.get(pool_id, {"fee_apr": 0.05, "incentive_apr": 0.0, "tvl_usd": 1000000, "il_risk": 0.03})
        
        return {
            "pool_id": pool_id,
            "fee_apr": fb["fee_apr"],
            "incentive_apr": fb["incentive_apr"],
            "total_apy": fb["fee_apr"] + fb["incentive_apr"],
            "tvl_usd": fb["tvl_usd"],
            "il_risk_score": fb["il_risk"],
            "source": "fallback"
        }
    
    def get_all_pool_metrics(self) -> Dict[str, Dict]:
        """Get metrics for all pools in our mapping."""
        results = {}
        for pool_id in self.POOL_MAPPINGS.keys():
            results[pool_id] = self.get_pool_metrics(pool_id)
        return results


def main():
    """Test the APY fetcher."""
    print("=== Testing APY Fetcher ===\n")
    
    fetcher = APYFetcher()
    
    # Fetch all pool metrics
    all_metrics = fetcher.get_all_pool_metrics()
    
    print("\n=== Pool Metrics ===")
    for pool_id, metrics in all_metrics.items():
        print(f"\n{pool_id}: {metrics.get('label', 'Unknown')}")
        print(f"  Source: {metrics['source']}")
        print(f"  Fee APR: {metrics['fee_apr']*100:.2f}%")
        print(f"  Incentive APR: {metrics['incentive_apr']*100:.2f}%")
        print(f"  Total APY: {metrics['total_apy']*100:.2f}%")
        print(f"  TVL: ${metrics['tvl_usd']:,.0f}")
        print(f"  IL Risk Score: {metrics['il_risk_score']:.3f}")
        if metrics.get('chain'):
            print(f"  Chain: {metrics['chain']}")
        if metrics.get('project'):
            print(f"  Project: {metrics['project']}")


if __name__ == "__main__":
    main()
