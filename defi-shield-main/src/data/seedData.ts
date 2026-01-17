import { Pool, Hedges, Scenario } from '@/types';

export const seedPools: Pool[] = [
  {
    pool_id: "POOL_1",
    label: "ETH/USDC LP",
    protocol: "Uniswap V3",
    chain: "Ethereum",
    strategy_type: "concentrated_liquidity",
    tokens: ["ETH", "USDC"],
    tvl_usd: 45000000,
    fee_tier_bps: 30,
    reward: {
      fee_apr: 0.12,
      incentive_apr: 0.05,
      base_apr: 0.0
    },
    risk: {
      il_risk_score: 0.5,
      price_vol_score: 0.55,
      liquidity_unwind_cost_usd: 150
    },
    execution: {
      gas_cost_usd_per_rebalance: 25,
      slippage_bps_per_rebalance: 5,
      mev_risk_score: 0.3,
      failure_prob_per_rebalance: 0.01
    }
  },
  {
    pool_id: "POOL_2",
    label: "WBTC/ETH LP",
    protocol: "Uniswap V3",
    chain: "Ethereum",
    strategy_type: "concentrated_liquidity",
    tokens: ["WBTC", "ETH"],
    tvl_usd: 28000000,
    fee_tier_bps: 30,
    reward: {
      fee_apr: 0.18,
      incentive_apr: 0.08,
      base_apr: 0.0
    },
    risk: {
      il_risk_score: 0.65,
      price_vol_score: 0.70,
      liquidity_unwind_cost_usd: 200
    },
    execution: {
      gas_cost_usd_per_rebalance: 30,
      slippage_bps_per_rebalance: 8,
      mev_risk_score: 0.4,
      failure_prob_per_rebalance: 0.015
    }
  },
  {
    pool_id: "POOL_3",
    label: "USDC/USDT Stable LP",
    protocol: "Curve",
    chain: "Ethereum",
    strategy_type: "stable_swap",
    tokens: ["USDC", "USDT"],
    tvl_usd: 120000000,
    fee_tier_bps: 4,
    reward: {
      fee_apr: 0.04,
      incentive_apr: 0.03,
      base_apr: 0.0
    },
    risk: {
      il_risk_score: 0.05,
      price_vol_score: 0.02,
      liquidity_unwind_cost_usd: 50
    },
    execution: {
      gas_cost_usd_per_rebalance: 15,
      slippage_bps_per_rebalance: 1,
      mev_risk_score: 0.05,
      failure_prob_per_rebalance: 0.002
    }
  },
  {
    pool_id: "POOL_4",
    label: "USDC Lending",
    protocol: "Aave V3",
    chain: "Ethereum",
    strategy_type: "lending",
    tokens: ["USDC"],
    tvl_usd: 500000000,
    fee_tier_bps: 0,
    reward: {
      fee_apr: 0.0,
      incentive_apr: 0.01,
      base_apr: 0.045
    },
    risk: {
      il_risk_score: 0.0,
      price_vol_score: 0.01,
      liquidity_unwind_cost_usd: 20
    },
    execution: {
      gas_cost_usd_per_rebalance: 10,
      slippage_bps_per_rebalance: 0,
      mev_risk_score: 0.02,
      failure_prob_per_rebalance: 0.001
    }
  },
  {
    pool_id: "POOL_5",
    label: "PEPE/ETH Volatile LP",
    protocol: "Uniswap V3",
    chain: "Ethereum",
    strategy_type: "concentrated_liquidity",
    tokens: ["PEPE", "ETH"],
    tvl_usd: 8000000,
    fee_tier_bps: 100,
    reward: {
      fee_apr: 0.45,
      incentive_apr: 0.15,
      base_apr: 0.0
    },
    risk: {
      il_risk_score: 0.90,
      price_vol_score: 0.95,
      liquidity_unwind_cost_usd: 500
    },
    execution: {
      gas_cost_usd_per_rebalance: 35,
      slippage_bps_per_rebalance: 25,
      mev_risk_score: 0.7,
      failure_prob_per_rebalance: 0.05
    }
  }
];

export const seedHedges: Hedges = {
  hedge_types: {
    none: {
      cost_apr: 0.0,
      il_multiplier: 1.0
    },
    protective_put: {
      cost_apr: 0.06,
      il_multiplier: 0.65
    },
    collar: {
      cost_apr: 0.03,
      il_multiplier: 0.80
    }
  },
  tenor_buckets: ["7D", "14D", "30D"],
  size_scaling: {
    S: 0.8,
    M: 1.0,
    L: 1.25
  }
};

export const seedScenarios: Scenario[] = [
  {
    scenario_id: "CALM",
    label: "Calm Market",
    description: "Low volatility, stable gas prices, minimal MEV activity",
    multipliers: {
      reward_multiplier: 0.9,
      il_risk_multiplier: 0.6,
      gas_multiplier: 0.7,
      slippage_multiplier: 0.5,
      mev_multiplier: 0.4,
      failure_multiplier: 0.5
    }
  },
  {
    scenario_id: "CHAOTIC",
    label: "Chaotic Market",
    description: "High volatility, gas spikes, aggressive MEV bots",
    multipliers: {
      reward_multiplier: 1.3,
      il_risk_multiplier: 1.8,
      gas_multiplier: 2.5,
      slippage_multiplier: 2.0,
      mev_multiplier: 2.0,
      failure_multiplier: 1.5
    }
  }
];
