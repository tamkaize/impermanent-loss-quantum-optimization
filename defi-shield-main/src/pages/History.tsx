import { Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { useAppState } from '@/hooks/useAppState';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  ChevronRight,
  History as HistoryIcon,
  Zap
} from 'lucide-react';

const History = () => {
  const { runs } = useAppState();

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const formatDelta = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(2)}%`;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <HistoryIcon className="w-6 h-6 text-primary" />
                Optimization History
              </h1>
              <p className="text-muted-foreground mt-1">
                {runs.length} past optimization{runs.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Link to="/optimizer">
              <Button className="gap-2">
                <Zap className="w-4 h-4" />
                New Optimization
              </Button>
            </Link>
          </div>

          {runs.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-border bg-card">
              <HistoryIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-medium mb-2">No optimizations yet</h2>
              <p className="text-muted-foreground mb-6">
                Run your first optimization to see results here.
              </p>
              <Link to="/optimizer">
                <Button>
                  <Zap className="w-4 h-4 mr-2" />
                  Open Optimizer
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  to={`/results/${run.id}`}
                  className="block p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${
                        run.baseline_comparison.delta_net_apr >= 0 
                          ? 'bg-success/10' 
                          : 'bg-destructive/10'
                      }`}>
                        {run.baseline_comparison.delta_net_apr >= 0 ? (
                          <TrendingUp className="w-5 h-5 text-success" />
                        ) : (
                          <TrendingDown className="w-5 h-5 text-destructive" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">
                          {run.decision.pool_label}
                          {run.decision.hedge_type !== 'none' && (
                            <span className="text-muted-foreground font-normal">
                              {' '}+ {run.decision.hedge_type.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {formatDate(run.timestamp)}
                          <span>•</span>
                          {run.inputs_used.scenario_id}
                          <span>•</span>
                          ${run.inputs_used.selected_buckets.position_size_usd.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Net APR</div>
                        <div className="font-mono font-medium text-primary">
                          {formatPercent(run.score_breakdown.net_apr.estimated_net_apr)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">vs Baseline</div>
                        <div className={`font-mono font-medium ${
                          run.baseline_comparison.delta_net_apr >= 0 
                            ? 'text-success' 
                            : 'text-destructive'
                        }`}>
                          {formatDelta(run.baseline_comparison.delta_net_apr)}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default History;
