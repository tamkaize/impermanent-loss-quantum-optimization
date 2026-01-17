"""Fetch live cryptocurrency prices from CoinGecko API."""
import time
from typing import Dict, Optional
import requests


class PriceFetcher:
    """Fetches live cryptocurrency prices from CoinGecko."""
    
    # CoinGecko API endpoint (free, no API key required)
    BASE_URL = "https://api.coingecko.com/api/v3/simple/price"
    
    # Map common symbols to CoinGecko IDs
    SYMBOL_TO_ID = {
        "ETH": "ethereum",
        "BTC": "bitcoin",
        "WBTC": "wrapped-bitcoin",
        "USDC": "usd-coin",
        "USDT": "tether",
    }
    
    # Default fallback prices (approximate as of 2026)
    DEFAULT_PRICES = {
        "ETH": 3500,
        "BTC": 65000,
        "WBTC": 65000,
        "USDC": 1.0,
        "USDT": 1.0,
    }
    
    def __init__(self, cache_ttl: int = 60):
        """
        Initialize price fetcher with cache TTL in seconds.
        
        Args:
            cache_ttl: Cache time-to-live in seconds (default: 60s for live prices)
        """
        self.cache_ttl = cache_ttl
        self.price_cache = {}
        self.cache_timestamp = {}
    
    def fetch_price(
        self, 
        symbol: str, 
        force_refresh: bool = False
    ) -> Optional[float]:
        """
        Fetch current price for a cryptocurrency.
        
        Args:
            symbol: Cryptocurrency symbol (e.g., "ETH", "BTC")
            force_refresh: If True, bypass cache
            
        Returns:
            Current price in USD, or None if fetch fails
        """
        symbol = symbol.upper()
        
        # Check cache
        if not force_refresh and symbol in self.price_cache:
            if time.time() - self.cache_timestamp.get(symbol, 0) < self.cache_ttl:
                print(f"[PriceFetcher] Using cached price for {symbol}: ${self.price_cache[symbol]:,.2f}")
                return self.price_cache[symbol]
        
        # Get CoinGecko ID
        coin_id = self.SYMBOL_TO_ID.get(symbol)
        if not coin_id:
            print(f"[PriceFetcher] Unknown symbol: {symbol}")
            return self.DEFAULT_PRICES.get(symbol)
        
        try:
            # Fetch from CoinGecko
            params = {
                "ids": coin_id,
                "vs_currencies": "usd"
            }
            
            print(f"[PriceFetcher] Fetching live price for {symbol}...")
            response = requests.get(self.BASE_URL, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            price = data.get(coin_id, {}).get("usd")
            
            if price is None:
                print(f"[PriceFetcher] No price data for {symbol}")
                return self.DEFAULT_PRICES.get(symbol)
            
            # Cache the result
            self.price_cache[symbol] = price
            self.cache_timestamp[symbol] = time.time()
            
            print(f"[PriceFetcher] {symbol} current price: ${price:,.2f}")
            return price
            
        except Exception as e:
            print(f"[PriceFetcher] Error fetching price for {symbol}: {e}")
            # Return cached price if available, otherwise fallback
            if symbol in self.price_cache:
                print(f"[PriceFetcher] Using stale cache for {symbol}")
                return self.price_cache[symbol]
            else:
                fallback = self.DEFAULT_PRICES.get(symbol)
                print(f"[PriceFetcher] Using fallback price for {symbol}: ${fallback:,.2f}")
                return fallback
    
    def fetch_eth_price(self, force_refresh: bool = False) -> float:
        """
        Convenience method to fetch ETH price.
        
        Args:
            force_refresh: If True, bypass cache
            
        Returns:
            Current ETH price in USD
        """
        price = self.fetch_price("ETH", force_refresh=force_refresh)
        return price if price is not None else self.DEFAULT_PRICES["ETH"]
    
    def fetch_btc_price(self, force_refresh: bool = False) -> float:
        """
        Convenience method to fetch BTC price.
        
        Args:
            force_refresh: If True, bypass cache
            
        Returns:
            Current BTC price in USD
        """
        price = self.fetch_price("BTC", force_refresh=force_refresh)
        return price if price is not None else self.DEFAULT_PRICES["BTC"]
    
    def fetch_multiple_prices(
        self, 
        symbols: list[str], 
        force_refresh: bool = False
    ) -> Dict[str, float]:
        """
        Fetch prices for multiple cryptocurrencies.
        
        Args:
            symbols: List of cryptocurrency symbols
            force_refresh: If True, bypass cache
            
        Returns:
            Dictionary mapping symbols to prices
        """
        prices = {}
        for symbol in symbols:
            price = self.fetch_price(symbol, force_refresh=force_refresh)
            if price is not None:
                prices[symbol] = price
        return prices


def main():
    """Test the price fetcher."""
    print("=== Testing Price Fetcher ===\n")
    
    fetcher = PriceFetcher()
    
    # Test ETH price
    print("=== Fetching ETH Price ===")
    eth_price = fetcher.fetch_eth_price()
    print(f"ETH Price: ${eth_price:,.2f}\n")
    
    # Test BTC price
    print("=== Fetching BTC Price ===")
    btc_price = fetcher.fetch_btc_price()
    print(f"BTC Price: ${btc_price:,.2f}\n")
    
    # Test cache (should use cached value)
    print("=== Testing Cache ===")
    eth_price_cached = fetcher.fetch_eth_price()
    print(f"ETH Price (cached): ${eth_price_cached:,.2f}\n")
    
    # Test multiple prices
    print("=== Fetching Multiple Prices ===")
    prices = fetcher.fetch_multiple_prices(["ETH", "BTC", "USDC"])
    for symbol, price in prices.items():
        print(f"{symbol}: ${price:,.2f}")


if __name__ == "__main__":
    main()
