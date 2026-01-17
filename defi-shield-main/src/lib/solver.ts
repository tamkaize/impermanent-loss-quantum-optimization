import { 
  Pool, 
  Hedges, 
  Scenario, 
  OptimizerResult, 
  SelectedBuckets, 
  HedgeType, 
  TenorBucket,
  ScoreBreakdown,
  BaselineComparison,
  Decision
} from '@/types';

// Rebalance frequency multipliers (how many times per year)
const REBALANCE_FREQUENCY: Record<string, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12
};

// Tenor cost adjustments
const TENOR_COST_MULTIPLIER: Record<string, number> = {
  '7D': 1.2,
  '14D': 1.0,
  '30D': 0.85
};

interface PoolScore {
  pool: Pool;
  hedgeType: HedgeType;
  tenorBucket: TenorBucket;
  breakdown: ScoreBreakdown;
  netApr: number;
}

// Get size bucket from position size
const getSizeBucket = (positionSizeUsd: number): 'S' | 'M' | 'L' => {
  if (positionSizeUsd < 10000) return 'S';
  if (positionSizeUsd < 100000) return 'M';
  return 'L';
};

// Calculate score for a single pool + hedge combination
export const calculatePoolScore = (
  pool: Pool,
  hedgeType: HedgeType,
  tenorBucket: TenorBucket,
  buckets: SelectedBuckets,
  hedges: Hedges,
  scenario: Scenario
): PoolScore => {
  const { multipliers } = scenario;
  const hedgeConfig = hedges.hedge_types[hedgeType];
  const positionSizeUsd = buckets.position_size_usd;
  const sizeBucket = getSizeBucket(positionSizeUsd);
  const sizeMultiplier = hedges.size_scaling[sizeBucket];
  const rebalanceFreq = REBALANCE_FREQUENCY[buckets.rebalance_bucket];
  const tenorMultiplier = TENOR_COST_MULTIPLIER[tenorBucket];

  // Calculate gross rewards (adjusted by scenario)
  const feeApr = pool.reward.fee_apr * multipliers.reward_multiplier;
  const incentiveApr = pool.reward.incentive_apr * multipliers.reward_multiplier;
  const baseApr = pool.reward.base_apr;
  const totalGrossApr = feeApr + incentiveApr + baseApr;

  // Calculate IL penalty
  const ilPenaltyApr = pool.risk.il_risk_score * 
    multipliers.il_risk_multiplier * 
    hedgeConfig.il_multiplier * 
    0.15; // Base IL impact factor

  // Calculate hedge cost
  const hedgeCostApr = hedgeConfig.cost_apr * 
    sizeMultiplier * 
    tenorMultiplier;

  // Calculate execution drag (annualized)
  const gasAnnual = (pool.execution.gas_cost_usd_per_rebalance * multipliers.gas_multiplier * rebalanceFreq) / positionSizeUsd;
  const slippageAnnual = (pool.execution.slippage_bps_per_rebalance / 10000) * multipliers.slippage_multiplier * rebalanceFreq;
  const mevAnnual = pool.execution.mev_risk_score * multipliers.mev_multiplier * 0.02 * rebalanceFreq / 52; // Weekly MEV exposure
  const executionDragApr = gasAnnual + slippageAnnual + mevAnnual;

  // Calculate risk penalty
  const failureRisk = pool.execution.failure_prob_per_rebalance * 
    multipliers.failure_multiplier * 
    rebalanceFreq * 
    0.01; // Impact per failure
  const riskPenaltyApr = failureRisk + (pool.risk.liquidity_unwind_cost_usd / positionSizeUsd) * 0.1;

  const totalCostsApr = ilPenaltyApr + hedgeCostApr + executionDragApr + riskPenaltyApr;
  const estimatedNetApr = totalGrossApr - totalCostsApr;

  return {
    pool,
    hedgeType,
    tenorBucket,
    breakdown: {
      rewards: {
        fee_apr: feeApr,
        incentive_apr: incentiveApr,
        base_apr: baseApr,
        total_gross_apr: totalGrossApr
      },
      penalties_and_costs: {
        il_penalty_apr: ilPenaltyApr,
        hedge_cost_apr: hedgeCostApr,
        execution_drag_apr: executionDragApr,
        risk_penalty_apr: riskPenaltyApr,
        total_costs_apr: totalCostsApr
      },
      net_apr: {
        estimated_net_apr: estimatedNetApr
      }
    },
    netApr: estimatedNetApr
  };
};

// Find baseline (max gross APR, no hedge)
const findBaseline = (
  pools: Pool[],
  buckets: SelectedBuckets,
  hedges: Hedges,
  scenario: Scenario
): { pool: Pool; score: PoolScore } => {
  let bestPool: Pool = pools[0];
  let bestScore = calculatePoolScore(pools[0], 'none', buckets.tenor_bucket, buckets, hedges, scenario);

  for (const pool of pools) {
    const score = calculatePoolScore(pool, 'none', buckets.tenor_bucket, buckets, hedges, scenario);
    if (score.breakdown.rewards.total_gross_apr > bestScore.breakdown.rewards.total_gross_apr) {
      bestPool = pool;
      bestScore = score;
    }
  }

  return { pool: bestPool, score: bestScore };
};

// Generate explanation bullets
const generateExplanation = (
  decision: Decision,
  breakdown: ScoreBreakdown,
  baseline: BaselineComparison
): string[] => {
  const explanations: string[] = [];

  // Explain the pool choice
  if (breakdown.rewards.total_gross_apr > 0.15) {
    explanations.push(`We picked ${decision.pool_label} because it earns ${(breakdown.rewards.total_gross_apr * 100).toFixed(1)}% per year in fees and rewards - that's pretty good!`);
  } else {
    explanations.push(`We chose ${decision.pool_label} because it's stable and safe, even though it earns a bit less (${(breakdown.rewards.total_gross_apr * 100).toFixed(1)}% per year).`);
  }

  // Explain the hedge
  if (decision.hedge_type === 'none') {
    explanations.push("We didn't add any protection because the extra cost wasn't worth it for this pool.");
  } else if (decision.hedge_type === 'protective_put') {
    explanations.push(`We added a protective put (like insurance) to protect you if prices drop sharply. It costs ${(breakdown.penalties_and_costs.hedge_cost_apr * 100).toFixed(1)}% but reduces your risk a lot.`);
  } else {
    explanations.push(`We used a collar hedge - it's cheaper protection that limits both your losses AND your gains a bit.`);
  }

  // Explain the delta
  if (baseline.delta_net_apr > 0) {
    explanations.push(`Compared to just picking the highest advertised APY, this strategy actually earns you ${(baseline.delta_net_apr * 100).toFixed(2)}% more per year after all costs!`);
  } else {
    explanations.push(`This strategy is about the same as the simple approach, but with less risk.`);
  }

  // Final summary
  explanations.push(`After paying for gas, dealing with slippage, and accounting for price movements, you can expect to earn about ${(breakdown.net_apr.estimated_net_apr * 100).toFixed(1)}% per year.`);

  return explanations;
};

// Main mock solver
export const runMockSolver = (
  pools: Pool[],
  hedges: Hedges,
  scenario: Scenario,
  buckets: SelectedBuckets
): OptimizerResult => {
  const hedgeTypes: HedgeType[] = ['none', 'protective_put', 'collar'];
  const tenorBuckets: TenorBucket[] = ['7D', '14D', '30D'];

  let bestScore: PoolScore | null = null;

  // Try all combinations
  for (const pool of pools) {
    for (const hedgeType of hedgeTypes) {
      for (const tenorBucket of tenorBuckets) {
        // Skip tenor if no hedge
        if (hedgeType === 'none' && tenorBucket !== buckets.tenor_bucket) continue;

        const score = calculatePoolScore(pool, hedgeType, tenorBucket, buckets, hedges, scenario);
        
        if (!bestScore || score.netApr > bestScore.netApr) {
          bestScore = score;
        }
      }
    }
  }

  if (!bestScore) {
    throw new Error('No valid pool combinations found');
  }

  // Calculate baseline comparison
  const baseline = findBaseline(pools, buckets, hedges, scenario);
  const baselineComparison: BaselineComparison = {
    baseline_pool_id: baseline.pool.pool_id,
    baseline_pool_label: baseline.pool.label,
    baseline_gross_apr: baseline.score.breakdown.rewards.total_gross_apr,
    baseline_net_apr: baseline.score.netApr,
    optimized_net_apr: bestScore.netApr,
    delta_net_apr: bestScore.netApr - baseline.score.netApr,
    improvement_pct: baseline.score.netApr !== 0 
      ? ((bestScore.netApr - baseline.score.netApr) / Math.abs(baseline.score.netApr)) * 100 
      : 0
  };

  const decision: Decision = {
    pool_id: bestScore.pool.pool_id,
    pool_label: bestScore.pool.label,
    hedge_type: bestScore.hedgeType,
    tenor_bucket: bestScore.tenorBucket,
    position_size_usd: buckets.position_size_usd,
    rebalance_bucket: buckets.rebalance_bucket
  };

  const explanations = generateExplanation(decision, bestScore.breakdown, baselineComparison);

  // Generate debug info
  const chosenBinaryVariables: Record<string, boolean> = {};
  for (const pool of pools) {
    chosenBinaryVariables[`x_${pool.pool_id}`] = pool.pool_id === bestScore.pool.pool_id;
  }
  for (const ht of hedgeTypes) {
    chosenBinaryVariables[`h_${ht}`] = ht === bestScore.hedgeType;
  }
  for (const tb of tenorBuckets) {
    chosenBinaryVariables[`t_${tb}`] = tb === bestScore.tenorBucket;
  }

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    inputs_used: {
      scenario_id: scenario.scenario_id,
      selected_buckets: buckets
    },
    decision,
    score: {
      objective_value: bestScore.netApr,
      units: 'APR-equivalent (decimal)'
    },
    score_breakdown: bestScore.breakdown,
    baseline_comparison: baselineComparison,
    explain_like_im_15: explanations,
    debug: {
      chosen_binary_variables: chosenBinaryVariables
    }
  };
};

// Validation functions
export const validatePools = (pools: Pool[]): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (pools.length < 3) {
    errors.push('Need at least 3 pools to run the optimizer');
  }

  for (const pool of pools) {
    const { fee_apr, incentive_apr, base_apr } = pool.reward;
    const allAprs = [fee_apr, incentive_apr, base_apr];
    
    for (const apr of allAprs) {
      if (apr < -1.0 || apr > 2.0) {
        errors.push(`Pool ${pool.pool_id}: APR values must be between -1.0 and 2.0`);
        break;
      }
    }

    if (pool.execution.failure_prob_per_rebalance < 0 || pool.execution.failure_prob_per_rebalance > 1) {
      errors.push(`Pool ${pool.pool_id}: failure_prob must be between 0 and 1`);
    }
  }

  return { valid: errors.length === 0, errors };
};

export const validateScenarios = (scenarios: Scenario[]): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (scenarios.length < 1) {
    errors.push('Need at least 1 scenario');
  }

  for (const scenario of scenarios) {
    const { multipliers } = scenario;
    const allMultipliers = Object.values(multipliers);
    
    for (const mult of allMultipliers) {
      if (mult < 0) {
        errors.push(`Scenario ${scenario.scenario_id}: multipliers must be >= 0`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
};
