import { OptimizerResult } from '@/types';
import {
  TrendingUp,
  TrendingDown,
  Shield,
  Repeat,
  DollarSign,
  ChevronDown,
  Lightbulb,
  Bug
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface ResultsViewProps {
  result: OptimizerResult;
}

export const ResultsView = ({ result }: ResultsViewProps) => {
  const { decision, score_breakdown, baseline_comparison, explain_like_im_15, debug } = result;

  const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const formatDelta = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
  };

  // Handle different response formats (Python vs Mock)
  const deltaNetApr = baseline_comparison.delta_net_apr ??
    (baseline_comparison as any).delta_vs_baseline?.net_apr_improvement ?? 0;
  const baselinePoolLabel = baseline_comparison.baseline_pool_label ??
    (baseline_comparison as any).baseline_decision?.pool_label ?? 'N/A';
  const baselineNetApr = baseline_comparison.baseline_net_apr ??
    (baseline_comparison as any).baseline_score_breakdown?.net_apr?.estimated_net_apr ?? 0;
  const optimizedNetApr = baseline_comparison.optimized_net_apr ??
    score_breakdown.net_apr.estimated_net_apr ?? 0;

  const hedgeLabel = {
    none: 'No Hedge',
    protective_put: 'Protective Put',
    collar: 'Collar Hedge'
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Main Recommendation */}
      <div className="p-6 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10 glow-primary">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          Recommended Strategy
        </h2>
        <p className="text-xl leading-relaxed">
          Choose <span className="font-bold text-primary">{decision.pool_label}</span>,
          use <span className="font-bold text-primary">{hedgeLabel[decision.hedge_type]}</span>
          {decision.hedge_type !== 'none' && (
            <> ({decision.tenor_bucket})</>
          )},
          position {decision.position_size_usd ? <span className="font-bold">${decision.position_size_usd.toLocaleString()}</span> : <span className="font-bold">{decision.size_bucket || 'Custom'}</span>},
          rebalance <span className="font-bold">{decision.rebalance_bucket}</span>.
        </p>
        <div className="mt-4 flex items-center gap-4">
          <div className="metric-card">
            <div className="text-sm text-muted-foreground">Net APR</div>
            <div className="text-2xl font-bold text-success">
              {formatPercent(score_breakdown.net_apr.estimated_net_apr)}
            </div>
          </div>
          <div className="metric-card">
            <div className="text-sm text-muted-foreground">vs Baseline</div>
            <div className={`text-2xl font-bold ${deltaNetApr >= 0 ? 'text-success' : 'text-destructive'
              }`}>
              {formatDelta(deltaNetApr)}
            </div>
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="p-6 rounded-xl border border-border bg-card">
        <h3 className="font-semibold mb-4">Score Breakdown</h3>
        <div className="space-y-4">
          {/* Rewards */}
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
              <DollarSign className="w-4 h-4" />
              Rewards
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Fee APR</div>
                <div className="font-mono text-success">{formatPercent(score_breakdown.rewards.fee_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Incentive APR</div>
                <div className="font-mono text-success">{formatPercent(score_breakdown.rewards.incentive_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Base APR</div>
                <div className="font-mono">{formatPercent(score_breakdown.rewards.base_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 border border-success/30">
                <div className="text-xs text-muted-foreground">Total Gross</div>
                <div className="font-mono font-bold text-success">{formatPercent(score_breakdown.rewards.total_gross_apr)}</div>
              </div>
            </div>
          </div>

          {/* Penalties & Costs */}
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
              <TrendingDown className="w-4 h-4" />
              Costs & Penalties
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">IL Penalty</div>
                <div className="font-mono text-destructive">-{formatPercent(score_breakdown.penalties_and_costs.il_penalty_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Hedge Cost</div>
                <div className="font-mono text-warning">-{formatPercent(score_breakdown.penalties_and_costs.hedge_cost_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Execution Drag</div>
                <div className="font-mono text-warning">-{formatPercent(score_breakdown.penalties_and_costs.execution_drag_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Risk Penalty</div>
                <div className="font-mono text-destructive">-{formatPercent(score_breakdown.penalties_and_costs.risk_penalty_apr)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 border border-destructive/30">
                <div className="text-xs text-muted-foreground">Total Costs</div>
                <div className="font-mono font-bold text-destructive">-{formatPercent(score_breakdown.penalties_and_costs.total_costs_apr)}</div>
              </div>
            </div>
          </div>

          {/* Net APR */}
          <div className="pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="font-medium">Estimated Net APR</span>
              <span className="text-2xl font-bold text-primary font-mono">
                {formatPercent(score_breakdown.net_apr.estimated_net_apr)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Baseline Comparison */}
      <div className="p-6 rounded-xl border border-border bg-card">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Repeat className="w-4 h-4" />
          Baseline Comparison
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Compared to just picking the highest gross APR ({baselinePoolLabel}) without hedging:
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">Baseline Net</div>
            <div className="font-mono text-lg">{formatPercent(baselineNetApr)}</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-primary/10 border border-primary/30">
            <div className="text-xs text-muted-foreground mb-1">Optimized Net</div>
            <div className="font-mono text-lg font-bold text-primary">{formatPercent(optimizedNetApr)}</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">Improvement</div>
            <div className={`font-mono text-lg font-bold ${deltaNetApr >= 0 ? 'text-success' : 'text-destructive'
              }`}>
              {formatDelta(deltaNetApr)}
            </div>
          </div>
        </div>
      </div>

      {/* Explain Like I'm 15 */}
      <div className="p-6 rounded-xl border border-border bg-card">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-warning" />
          Explain Like I'm 15
        </h3>
        <ul className="space-y-3">
          {explain_like_im_15.map((explanation, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-sm flex items-center justify-center font-medium">
                {idx + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">{explanation}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Debug Accordion */}
      <Accordion type="single" collapsible>
        <AccordionItem value="debug" className="border rounded-xl">
          <AccordionTrigger className="px-6 hover:no-underline">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4" />
              <span>Debug Information</span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="bg-muted/30 rounded-lg p-4 font-mono text-sm overflow-x-auto">
              <pre>{JSON.stringify(debug.chosen_binary_variables, null, 2)}</pre>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
