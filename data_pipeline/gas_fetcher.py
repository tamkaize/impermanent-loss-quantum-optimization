"""Fetch real-time gas prices from Etherscan and other block explorers."""
import os
import json
import time
from typing import Dict, Optional
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class GasFetcher:
    """Fetches gas prices for multiple chains using Etherscan API V2."""
    
    # Etherscan API V2 - unified endpoint for all chains
    BASE_URL = "https://api.etherscan.io/v2/api"
    
    # Chain configurations with chain IDs
    CHAINS = {
        "ethereum": {
            "name": "Ethereum",
            "chainid": 1
        },
        "arbitrum": {
            "name": "Arbitrum",
            "chainid": 42161
        },
        "polygon": {
            "name": "Polygon",
            "chainid": 137
        }
    }
    
    # Fallback gas prices (in Gwei) if API fails
    FALLBACK_GAS_PRICES = {
        "ethereum": 20.0,
        "arbitrum": 0.1,
        "polygon": 50.0
    }
    
    def __init__(self, cache_ttl: int = 300):
        """Initialize gas fetcher with cache TTL in seconds."""
        self.cache_ttl = cache_ttl
        self.cache = {}
        
    def fetch_gas_price(self, chain: str) -> Dict[str, float]:
        """
        Fetch current gas price for a specific chain using Etherscan API V2.
        
        Args:
            chain: Chain name (ethereum, arbitrum, polygon)
            
        Returns:
            Dictionary with gas prices in Gwei:
            {
                "safe": float,
                "propose": float,
                "fast": float,
                "timestamp": float
            }
        """
        # Check cache first
        if chain in self.cache:
            cached_data = self.cache[chain]
            if time.time() - cached_data["timestamp"] < self.cache_ttl:
                print(f"[GasFetcher] Using cached gas price for {chain}")
                return cached_data
        
        chain_config = self.CHAINS.get(chain)
        if not chain_config:
            print(f"[GasFetcher] Unknown chain: {chain}, using fallback")
            return self._fallback_gas_price(chain)
        
        # Get API key (single key for all chains with V2)
        api_key = os.getenv("ETHERSCAN_API_KEY")
        if not api_key:
            print(f"[GasFetcher] No ETHERSCAN_API_KEY set, using fallback for {chain}")
            return self._fallback_gas_price(chain)
        
        try:
            # Build Etherscan V2 API request
            params = {
                "chainid": chain_config["chainid"],
                "module": "gastracker",
                "action": "gasoracle",
                "apikey": api_key
            }
            
            response = requests.get(
                self.BASE_URL,
                params=params,
                timeout=10
            )
            response.raise_for_status()
            
            data = response.json()
            
            if data.get("status") == "1" and data.get("result"):
                result = data["result"]
                gas_data = {
                    "safe": float(result.get("SafeGasPrice", 0)),
                    "propose": float(result.get("ProposeGasPrice", 0)),
                    "fast": float(result.get("FastGasPrice", 0)),
                    "timestamp": time.time()
                }
                
                # Cache the result
                self.cache[chain] = gas_data
                print(f"[GasFetcher] Fetched gas for {chain}: {gas_data['propose']} Gwei")
                return gas_data
            else:
                print(f"[GasFetcher] API returned error for {chain}: {data.get('message')}")
                return self._fallback_gas_price(chain)
                
        except Exception as e:
            print(f"[GasFetcher] Error fetching gas for {chain}: {e}")
            return self._fallback_gas_price(chain)
    
    def _fallback_gas_price(self, chain: str) -> Dict[str, float]:
        """Return fallback gas price for a chain."""
        fallback = self.FALLBACK_GAS_PRICES.get(chain, 20.0)
        return {
            "safe": fallback * 0.8,
            "propose": fallback,
            "fast": fallback * 1.2,
            "timestamp": time.time(),
            "fallback": True
        }
    
    def calculate_gas_cost_usd(
        self, 
        gas_gwei: float, 
        gas_units: int, 
        eth_price_usd: float
    ) -> float:
        """
        Calculate gas cost in USD.
        
        Args:
            gas_gwei: Gas price in Gwei
            gas_units: Number of gas units for transaction
            eth_price_usd: Current ETH price in USD
            
        Returns:
            Gas cost in USD
        """
        # Convert Gwei to ETH: 1 ETH = 10^9 Gwei
        gas_eth = (gas_gwei * gas_units) / 1e9
        gas_usd = gas_eth * eth_price_usd
        return gas_usd
    
    def fetch_all_chains(self) -> Dict[str, Dict[str, float]]:
        """Fetch gas prices for all supported chains."""
        results = {}
        for chain in self.CHAINS.keys():
            results[chain] = self.fetch_gas_price(chain)
        return results


def main():
    """Test the gas fetcher."""
    print("=== Testing Gas Fetcher ===\n")
    
    fetcher = GasFetcher()
    
    # Fetch for all chains
    all_gas = fetcher.fetch_all_chains()
    
    print("\n=== Gas Prices (Gwei) ===")
    for chain, data in all_gas.items():
        fallback_flag = " (FALLBACK)" if data.get("fallback") else ""
        print(f"\n{chain.upper()}{fallback_flag}:")
        print(f"  Safe:    {data['safe']:.2f} Gwei")
        print(f"  Propose: {data['propose']:.2f} Gwei")
        print(f"  Fast:    {data['fast']:.2f} Gwei")
    
    # Example cost calculation (assuming ETH = $3000)
    print("\n=== Example: Uniswap V3 LP Deposit Cost ===")
    eth_price = 3000
    uniswap_gas_units = 200000  # Typical for LP deposit
    
    eth_gas = all_gas["ethereum"]["propose"]
    cost_usd = fetcher.calculate_gas_cost_usd(eth_gas, uniswap_gas_units, eth_price)
    print(f"Gas Price: {eth_gas} Gwei")
    print(f"Transaction Cost: ${cost_usd:.2f}")


if __name__ == "__main__":
    main()
