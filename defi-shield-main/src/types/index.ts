// Pool types
export interface PoolReward {
  fee_apr: number;
  incentive_apr: number;
  base_apr: number;
}

export interface PoolRisk {
  il_risk_score: number;
  price_vol_score: number;
  liquidity_unwind_cost_usd: number;
}

export interface PoolExecution {
  gas_cost_usd_per_rebalance: number;
  slippage_bps_per_rebalance: number;
  mev_risk_score: number;
  failure_prob_per_rebalance: number;
}

export interface Pool {
  pool_id: string;
  label: string;
  protocol: string;
  chain: string;
  strategy_type: string;
  tokens: string[];
  tvl_usd: number;
  fee_tier_bps: number;
  reward: PoolReward;
  risk: PoolRisk;
  execution: PoolExecution;
}

// Hedge types
export interface HedgeConfig {
  cost_apr: number;
  il_multiplier: number;
}

export interface SizeScaling {
  S: number;
  M: number;
  L: number;
}

export interface Hedges {
  hedge_types: {
    none: HedgeConfig;
    protective_put: HedgeConfig;
    collar: HedgeConfig;
  };
  tenor_buckets: string[];
  size_scaling: SizeScaling;
}

// Scenario types
export interface ScenarioMultipliers {
  reward_multiplier: number;
  il_risk_multiplier: number;
  gas_multiplier: number;
  slippage_multiplier: number;
  mev_multiplier: number;
  failure_multiplier: number;
}

export interface Scenario {
  scenario_id: string;
  label: string;
  description: string;
  multipliers: ScenarioMultipliers;
}

// Buckets
export type SizeBucket = 'S' | 'M' | 'L';
export type RebalanceBucket = 'daily' | 'weekly' | 'monthly';
export type TenorBucket = '7D' | '14D' | '30D';
export type HedgeType = 'none' | 'protective_put' | 'collar';

// Selected buckets
export interface SelectedBuckets {
  position_size_usd: number;
  rebalance_bucket: RebalanceBucket;
  tenor_bucket: TenorBucket;
}

// Result types
export interface Decision {
  pool_id: string;
  pool_label: string;
  hedge_type: HedgeType;
  tenor_bucket: TenorBucket;
  position_size_usd: number;
  rebalance_bucket: RebalanceBucket;
}

export interface ScoreBreakdown {
  rewards: {
    fee_apr: number;
    incentive_apr: number;
    base_apr: number;
    total_gross_apr: number;
  };
  penalties_and_costs: {
    il_penalty_apr: number;
    hedge_cost_apr: number;
    execution_drag_apr: number;
    risk_penalty_apr: number;
    total_costs_apr: number;
  };
  net_apr: {
    estimated_net_apr: number;
  };
}

export interface BaselineComparison {
  baseline_pool_id: string;
  baseline_pool_label: string;
  baseline_gross_apr: number;
  baseline_net_apr: number;
  optimized_net_apr: number;
  delta_net_apr: number;
  improvement_pct: number;
}

export interface OptimizerResult {
  id: string;
  timestamp: string;
  inputs_used: {
    scenario_id: string;
    selected_buckets: SelectedBuckets;
  };
  decision: Decision;
  score: {
    objective_value: number;
    units: string;
  };
  score_breakdown: ScoreBreakdown;
  baseline_comparison: BaselineComparison;
  explain_like_im_15: string[];
  debug: {
    chosen_binary_variables: Record<string, boolean>;
  };
}

// App state
export interface AppState {
  pools: Pool[];
  hedges: Hedges;
  scenarios: Scenario[];
  runs: OptimizerResult[];
}
