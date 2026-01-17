import { useParams, Link } from 'react-router-dom';
import { Header } from '@/components/Header';
import { ResultsView } from '@/components/ResultsView';
import { useAppState } from '@/hooks/useAppState';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock } from 'lucide-react';

const Results = () => {
  const { id } = useParams<{ id: string }>();
  const { runs } = useAppState();
  
  const result = runs.find(r => r.id === id);

  if (!result) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-2xl font-bold mb-4">Result Not Found</h1>
            <p className="text-muted-foreground mb-6">
              This optimization result may have been deleted or doesn't exist.
            </p>
            <Link to="/history">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to History
              </Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Link to="/history">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to History
              </Button>
            </Link>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              {formatDate(result.timestamp)}
            </div>
          </div>

          <div className="p-6 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
              <div>
                <h1 className="text-xl font-bold">Optimization Result</h1>
                <p className="text-sm text-muted-foreground">
                  Scenario: {result.inputs_used.scenario_id} • 
                  Position: ${result.inputs_used.selected_buckets.position_size_usd.toLocaleString()} • 
                  Rebalance: {result.inputs_used.selected_buckets.rebalance_bucket}
                </p>
              </div>
            </div>
            
            <ResultsView result={result} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Results;
