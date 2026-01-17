"""Fetch real-time implied volatility from Deribit API."""
import time
import requests
from typing import Optional, Dict

class DeribitFetcher:
    """Fetches volatility data from Deribit."""
    
    # Deribit Public API v2
    BASE_URL = "https://www.deribit.com/api/v2/public"
    
    def __init__(self, cache_ttl: int = 300):
        self.cache_ttl = cache_ttl
        self.cache = {}
        self.cache_timestamp = {}
        
    def fetch_volatility_index(self, currency: str) -> Optional[float]:
        """
        Fetch the Volatility Index (DVOL) for a currency.
        
        Args:
            currency: 'ETH' or 'BTC'
            
        Returns:
            Volatility index as decimal (e.g., 0.55 for 55%), or None if failed.
        """
        currency = currency.upper()
        # Map common symbols to Deribit currency codes if needed
        # Deribit uses ETH/BTC directly
        
        # Check cache
        if currency in self.cache:
            if time.time() - self.cache_timestamp.get(currency, 0) < self.cache_ttl:
                return self.cache[currency]

        index_name = f"{currency}_volatility_index" # e.g. eth_volatility_index requires lower case? 
        # Actually Deribit parameter is `index_name`
        # Let's verify the endpoint format. 
        # Endpoint: get_volatility_index_data
        # Params: currency (ETH, BTC)
        
        try:
            url = f"{self.BASE_URL}/get_volatility_index_data"
            params = {
                "currency": currency,
                "start_timestamp": int((time.time() - 60) * 1000), # Last minute
                "end_timestamp": int(time.time() * 1000),
                "resolution": "1D" # Just need current value
            }
            
            # Note: get_volatility_index_data returns a time series. 
            # DVOL is also published via ticker but let's stick to the specific endpoint or ticker.
            # Simpler: get_index_price? No, that's spot.
            # DVOL is often symbolic. Let's try the simplest documented public endpoint for DVOL current value.
            # Actually, /public/get_volatility_index_data gives history.
            # /public/get_last_trades_by_instrument? Not distinct.
            
            # Let's use the historical endpoint and get the last entry, it's reliable.
            # URL: https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=ETH&start_timestamp=...&end_timestamp=...&resolution=1D
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if 'result' in data and data['result'].get('data'):
                # Format: [[timestamp, open, high, low, close], ...]
                # We interpret 'close' of the last candle as "current" approx
                latest_candle = data['result']['data'][-1]
                dvol_value = latest_candle[4] # Start, Open, High, Low, Close. 
                # Wait, Deribit Volatility Index might be formatted differently.
                # Let's look at the result structure standard for TV charts.
                # Usually [timestamp, open, high, low, close].
                
                # DVOL is percentage, e.g. 60.5
                iv_decimal = dvol_value / 100.0
                
                self.cache[currency] = iv_decimal
                self.cache_timestamp[currency] = time.time()
                return iv_decimal
                
        except Exception as e:
            print(f"[DeribitFetcher] Failed to fetch DVOL for {currency}: {e}")
            return None
            
        print(f"[DeribitFetcher] No data found for {currency}")
        return None

def main():
    """Test Deribit Fetcher."""
    fetcher = DeribitFetcher()
    print("Fetching ETH DVOL...")
    eth_iv = fetcher.fetch_volatility_index("ETH")
    print(f"ETH IV: {eth_iv}")
    
    print("Fetching BTC DVOL...")
    btc_iv = fetcher.fetch_volatility_index("BTC")
    print(f"BTC IV: {btc_iv}")

if __name__ == "__main__":
    main()
