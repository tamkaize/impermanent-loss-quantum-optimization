# Crypto Yield Optimization - Data Pipeline

Built for 24-hour MVP implementation using real DeFi APIs.

## Overview

This data pipeline fetches real-time cryptocurrency and DeFi data from multiple sources:

- **Gas Prices**: Etherscan, Arbiscan, Polygonscan
- **Yields/APY**: DefiLlama API
- **Hedge Pricing**: Black-Scholes model with market IV
- **Scenarios**: Market condition multipliers

## Quick Start

### 1. Install uv (if not already installed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Clone and Setup

```bash
cd impermanent-loss-quantum-optimization

# Create virtual environment and install dependencies with uv
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
uv pip install -e .
```

### 3. Configure API Keys

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env and add your API keys
```

**Required API Keys**:
- `ETHERSCAN_API_KEY`: Get from https://etherscan.io/apis (works for Ethereum, Arbitrum, Polygon, and 50+ other chains via API V2)

**Optional**:
- `COINGECKO_API_KEY`: Use "demo" for free tier

### 4. Run Data Pipeline

```bash
# Test individual fetchers
python -m data_pipeline.gas_fetcher
python -m data_pipeline.apy_fetcher
python -m data_pipeline.hedge_pricer
python -m data_pipeline.scenario_builder

# Run all fetchers and update JSON files
python -m data_pipeline.run_all
```

## Architecture

```
data_pipeline/
├── __init__.py
├── gas_fetcher.py       # Fetch gas prices from block explorers
├── apy_fetcher.py       # Fetch yields from DefiLlama
├── hedge_pricer.py      # Calculate hedge costs with Black-Scholes
├── scenario_builder.py  # Generate market scenarios
└── run_all.py          # Orchestration script
```

## Data Sources

### Gas Fetcher

- **Unified API**: Etherscan API V2 with single API key
- **Chains Supported**: Ethereum, Arbitrum, Polygon (and 50+ others)
- **Endpoint**: `https://api.etherscan.io/v2/api` with `chainid` parameter

**Features**:
- Real-time gas prices (Safe, Propose, Fast)
- Automatic caching (5min TTL)
- Fallback to reasonable defaults if API fails
- USD cost calculation based on ETH price

### APY Fetcher

- **Primary**: DefiLlama `/pools` endpoint
- **Free tier**: 200 requests/minute

**Pool Mappings**:
- POOL_1: Uniswap V3 ETH/USDC 0.05% (Ethereum)
- POOL_2: Uniswap V3 WBTC/ETH 0.30% (Arbitrum)
- POOL_3: Curve USDC/USDT (Ethereum)
- POOL_4: Aave V3 USDC Lending (Arbitrum)
- POOL_5: High-yield volatile LP (>50% APY)

**Features**:
- Automatic pool matching by chain/token/protocol
- Extracts fee APR and incentive APR separately
- Calculates IL risk proxy from volatility
- TVL filtering (minimum $100k)

### Hedge Pricer

- **Model**: Black-Scholes option pricing
- **Data**: Market IV for ETH (~60%), BTC (~50%)

**Hedge Types**:
1. **Protective Put**: Buy ATM put for downside protection
2. **Collar**: Buy OTM put + Sell OTM call for lower cost
3. **None**: No hedging

**Tenors**: 7D, 14D, 30D

**Outputs**:
- Cost in APR-equivalent
- Protection multiplier (IL reduction)
- Strike prices

### Scenario Builder

Pre-defined market scenarios:

1. **CALM**: Low volatility, normal gas (~80% of base costs)
2. **CHAOTIC**: High volatility, elevated gas (~160% of base costs)

**Multipliers**:
- IL risk: 0.8x (calm) to 1.6x (chaotic)
- Gas costs: 0.8x to 1.8x
- MEV risk: 0.7x to 1.8x
- Slippage: 0.8x to 1.6x

## Output Files

Pipeline updates these JSON files in `data/`:

### pools.json
```json
{
  "pools": [
    {
      "pool_id": "POOL_1",
      "reward": {
        "fee_apr": 0.08,
        "incentive_apr": 0.02
      },
      "risk": {
        "il_risk_score": 0.05
      },
      "execution": {
        "gas_cost_usd_per_rebalance": 12.50
      }
    }
  ]
}
```

### hedges.json
```json
{
  "hedge_types": [
    {
      "key": "protective_put",
      "default_cost_apr": 0.06,
      "default_il_multiplier": 0.65
    }
  ]
}
```

### scenarios.json
```json
{
  "scenarios": [
    {
      "scenario_id": "CHAOTIC",
      "multipliers": {
        "il_risk_multiplier": 1.6,
        "gas_multiplier": 1.8
      }
    }
  ]
}
```

## Error Handling

All fetchers include:
- **Caching**: Reduce API calls, use recent data if API fails
- **Fallbacks**: Hardcoded reasonable values for MVP
- **Timeouts**: 10-15 second request timeouts
- **Logging**: Clear console output for debugging

## API Rate Limits

| API | Free Tier Limit | Notes |
|-----|-----------------|-------|
| Etherscan | 5 req/sec | Sufficient for MVP |
| DefiLlama | 200 req/min | No auth required |
| CoinGecko | 50 req/min | For price data |

## Testing

Each module has a `main()` function for standalone testing:

```bash
# Test gas fetcher
python -m data_pipeline.gas_fetcher

# Expected output:
# === Gas Prices (Gwei) ===
# ETHEREUM:
#   Safe:    18.00 Gwei
#   Propose: 20.00 Gwei
#   Fast:    24.00 Gwei
```

## Production TODOs

For production deployment (beyond MVP):

- [ ] Add price fetcher for ETH/BTC (currently hardcoded)
- [ ] Integrate real Deribit IV data (currently using defaults)
- [ ] Add database for historical tracking
- [ ] Implement exponential backoff for retries
- [ ] Add monitoring/alerting for API failures
- [ ] Support more chains (Base, Optimism, etc.)
- [ ] Add WebSocket support for real-time updates

## Troubleshooting

**Issue**: API key errors

```
Solution: Check .env file exists and has valid keys
```

**Issue**: Import errors

```bash
Solution: Make sure you're in the venv and installed with uv
source .venv/bin/activate
uv pip install -e .
```

**Issue**: No data returned

```
Solution: Check internet connection and API status
- Etherscan: https://etherscan.io/apis
- DefiLlama: https://defillama.com/docs/api
```

## License

MIT
