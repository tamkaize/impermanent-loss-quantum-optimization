import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { ScenarioSelector } from '@/components/ScenarioSelector';
import { BucketSelector } from '@/components/BucketSelector';
import { PoolTable } from '@/components/PoolTable';
import { ImportExportButtons } from '@/components/ImportExportButtons';
import { ResultsView } from '@/components/ResultsView';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppState } from '@/hooks/useAppState';
import { runMockSolver, validatePools, validateScenarios } from '@/lib/solver';
import { SelectedBuckets, OptimizerResult } from '@/types';
import { Zap, AlertCircle, RotateCcw, Loader2, Clock, XCircle, Play, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

type JobStatus = 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';

const Optimizer = () => {
  const navigate = useNavigate();
  const {
    pools,
    hedges,
    scenarios,
    addRun,
    importPools,
    importHedges,
    importScenarios,
    exportPools,
    exportHedges,
    exportScenarios,
    resetToDefaults
  } = useAppState();

  const [selectedScenario, setSelectedScenario] = useState(scenarios[0]?.scenario_id || 'CALM');
  const [isWaitlistJoined, setIsWaitlistJoined] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [hasRunOptimizer, setHasRunOptimizer] = useState(false);
  const [selectedBuckets, setSelectedBuckets] = useState<SelectedBuckets>({
    position_size_usd: null as unknown as number,
    rebalance_bucket: 'weekly',
    tenor_bucket: '14D'
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Removed isApiMode effect

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    stopPolling();
    setJobStatus('idle');
    setCurrentJobId(null);
    setPollCount(0);
    setElapsedTime(0);
    toast.info('Optimization cancelled');
  }, [stopPolling]);

  const pollJobStatus = useCallback(async (jobId: string) => {
    const elapsed = Date.now() - (startTimeRef.current || Date.now());

    if (elapsed > MAX_POLL_DURATION_MS) {
      stopPolling();
      setJobStatus('failed');
      toast.error('Optimization timed out after 5 minutes. Please try again.');
      return;
    }

    setPollCount((prev) => prev + 1);

    try {
      const payload = {
        action: "status" as const,
        job_id: jobId,
        scenario_id: selectedScenario,
        pools,
        hedges,
        scenarios,
        selected_buckets: selectedBuckets,
        request_baseline: true,
      };

      console.log(`[DIRAC-3] Polling status (attempt ${pollCount + 1})`, { job_id: jobId });

      const { data, error } = await supabase.functions.invoke('dirac-solver', {
        body: payload,
      });

      if (error) {
        console.error('Status poll error:', error);
        // Don't stop polling on transient errors
        return;
      }

      console.log('[DIRAC-3] Status response:', data);

      if (data?.status === 'COMPLETED' && data?.result) {
        stopPolling();
        setJobStatus('completed');
        setResult(data.result as OptimizerResult);
        setHasRunOptimizer(true);
        addRun(data.result as OptimizerResult);
        toast.success('DIRAC-3 optimization complete!');
      } else if (data?.status === 'FAILED') {
        stopPolling();
        setJobStatus('failed');
        toast.error('DIRAC-3 job failed. Falling back to mock solver.');

        // Fallback to mock
        const scenario = scenarios.find(s => s.scenario_id === selectedScenario)!;
        const mockResult = runMockSolver(pools, hedges, scenario, selectedBuckets);
        setResult(mockResult);
        setHasRunOptimizer(true);
        addRun(mockResult);
      }
      // If status is RUNNING or other, continue polling
    } catch (err) {
      console.error('Poll error:', err);
      // Continue polling on errors
    }
  }, [selectedScenario, pools, hedges, scenarios, selectedBuckets, pollCount, stopPolling, addRun]);

  const isPositionValid = selectedBuckets.position_size_usd !== null &&
    selectedBuckets.position_size_usd > 0 &&
    !isNaN(selectedBuckets.position_size_usd);

  const isRunning = jobStatus === 'submitting' || jobStatus === 'polling';

  const executeOptimization = async (scenarioId: string, buckets: SelectedBuckets) => {
    // Validate position size
    const isPosValid = buckets.position_size_usd !== null &&
      buckets.position_size_usd > 0 &&
      !isNaN(buckets.position_size_usd);

    if (!isPosValid) {
      setPositionError('Please enter a valid amount');
      toast.error('Please enter a valid position size');
      return;
    }

    // Validate inputs
    const poolValidation = validatePools(pools);
    if (!poolValidation.valid) {
      toast.error(poolValidation.errors[0]);
      return;
    }

    const scenarioValidation = validateScenarios(scenarios);
    if (!scenarioValidation.valid) {
      toast.error(scenarioValidation.errors[0]);
      return;
    }

    const scenario = scenarios.find(s => s.scenario_id === scenarioId);
    if (!scenario) {
      toast.error('Please select a scenario');
      return;
    }

    setJobStatus('submitting');
    setResult(null);
    setPollCount(0);
    setElapsedTime(0);

    try {
      // Always run mock optimizer
      const useMock = true;
      toast.info('Running optimizer...');

      const payload = {
        scenario_id: scenarioId,
        selected_buckets: buckets,
        num_samples: 10,
        relaxation_schedule: 1,
        use_mock: useMock
      };

      const response = await fetch('http://localhost:8000/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Local server error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[Optimizer] Result:', data);

      setResult(data);
      setHasRunOptimizer(true);
      addRun(data);
      setJobStatus('completed');
      toast.success('Optimization complete!');

    } catch (err) {
      console.warn('Backend optimizer failed, falling back to client-side mock:', err);
      toast.info('Falling back to in-browser engine.');

      // Fallback to client-side mock
      const mockResult = runMockSolver(pools, hedges, scenario, buckets);
      setResult(mockResult);
      setHasRunOptimizer(true);
      addRun(mockResult);
      setJobStatus('completed');
    }

  };

  const handleRunOptimizer = () => {
    executeOptimization(selectedScenario, selectedBuckets);
  };

  const handleDemoMode = () => {
    const demoBuckets: SelectedBuckets = {
      position_size_usd: 10000,
      rebalance_bucket: 'weekly',
      tenor_bucket: '14D'
    };
    const demoScenario = scenarios[0]?.scenario_id || 'CALM';

    // Update state to reflect demo values
    setSelectedBuckets(demoBuckets);
    setSelectedScenario(demoScenario);
    setPositionError(null);

    // Run optimization
    executeOptimization(demoScenario, demoBuckets);
  };

  const getStatusMessage = () => {
    if (jobStatus === 'submitting') return 'Starting engine...';
    if (jobStatus === 'polling') {
      const mins = Math.floor(elapsedTime / 60);
      const secs = elapsedTime % 60;
      return `Quantum Processing... ${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return 'Run Optimizer';
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Sidebar */}
          {/* Left Sidebar - Strategy Configuration */}
          <div className="lg:w-80 space-y-6">
            <div className="p-5 rounded-xl border border-border bg-card/50 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Strategy Config
              </h2>

              <div className="space-y-6">
                <ScenarioSelector
                  scenarios={scenarios}
                  selected={selectedScenario}
                  onSelect={setSelectedScenario}
                />

                <BucketSelector
                  selected={selectedBuckets}
                  onChange={setSelectedBuckets}
                  positionError={positionError}
                  onPositionErrorChange={setPositionError}
                />

                <div className="pt-2">
                  <div className="p-4 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Lock className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium text-muted-foreground">Quantum Backend</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Dirac-3 Quantum access is currently limited. Sign up to get early access.
                    </p>
                    {isWaitlistJoined ? (
                      <div className="text-xs text-green-500 font-medium flex items-center gap-1">
                        ✓ You're on the waitlist!
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-8"
                        onClick={() => {
                          setIsWaitlistJoined(true);
                          toast.success("You've been added to the Quantum Waitlist!");
                        }}
                      >
                        Join Waitlist
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <Button
                  onClick={handleRunOptimizer}
                  disabled={isRunning}
                  className="w-full gap-2 relative overflow-hidden group"
                  size="lg"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  {isRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {getStatusMessage()}
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 group-hover:text-white transition-colors" />
                      Run Optimizer
                    </>
                  )}
                </Button>

                {!isRunning && !result && (
                  <Button
                    onClick={handleDemoMode}
                    variant="secondary"
                    className="w-full gap-2"
                    size="lg"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Demo Mode (Instant)
                  </Button>
                )}

                {isRunning && (
                  <Button
                    variant="destructive"
                    onClick={handleCancel}
                    className="w-full gap-2"
                    size="sm"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </Button>
                )}

                {!isRunning && (
                  <Button
                    variant="ghost"
                    onClick={resetToDefaults}
                    className="w-full gap-2 text-muted-foreground hover:text-foreground"
                    size="sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset to Defaults
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 space-y-6">
            {/* Results - shown first when available */}
            {result && (
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-xl font-bold mb-6">Optimization Results</h2>
                <ResultsView result={result} />
              </div>
            )}

            {/* Data Tabs - only shown after running optimizer */}
            {hasRunOptimizer && (
              <div className="rounded-xl border border-border bg-card p-6">
                <Tabs defaultValue="pools">
                  <div className="flex items-center justify-between mb-4">
                    <TabsList>
                      <TabsTrigger value="pools">Pools ({pools.length})</TabsTrigger>
                      <TabsTrigger value="hedges">Hedges</TabsTrigger>
                      <TabsTrigger value="scenarios">Scenarios ({scenarios.length})</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="pools" className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-muted-foreground">
                        Configure the DeFi pools to analyze
                      </p>
                      <ImportExportButtons
                        onImport={importPools}
                        onExport={exportPools}
                        label="Pools"
                      />
                    </div>
                    {pools.length < 3 && (
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 mb-4">
                        <AlertCircle className="w-4 h-4 text-warning" />
                        <span className="text-sm text-warning">Need at least 3 pools to run optimizer</span>
                      </div>
                    )}
                    <PoolTable pools={pools} />
                  </TabsContent>

                  <TabsContent value="hedges" className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-muted-foreground">
                        Hedge configurations and cost parameters
                      </p>
                      <ImportExportButtons
                        onImport={importHedges}
                        onExport={exportHedges}
                        label="Hedges"
                      />
                    </div>
                    <div className="grid md:grid-cols-3 gap-4">
                      {Object.entries(hedges.hedge_types).map(([type, config]) => (
                        <div key={type} className="p-4 rounded-lg bg-muted/30 border border-border">
                          <h4 className="font-medium capitalize mb-2">
                            {type.replace(/_/g, ' ')}
                          </h4>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Cost APR</span>
                              <span className="font-mono">{(config.cost_apr * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">IL Reduction</span>
                              <span className="font-mono">{((1 - config.il_multiplier) * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 p-4 rounded-lg bg-muted/30 border border-border">
                      <h4 className="font-medium mb-2">Size Scaling</h4>
                      <div className="flex gap-4">
                        {Object.entries(hedges.size_scaling).map(([size, mult]) => (
                          <div key={size} className="text-sm">
                            <span className="text-muted-foreground">{size}:</span>{' '}
                            <span className="font-mono">{mult}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="scenarios" className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-muted-foreground">
                        Market condition scenarios with multipliers
                      </p>
                      <ImportExportButtons
                        onImport={importScenarios}
                        onExport={exportScenarios}
                        label="Scenarios"
                      />
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {scenarios.map((scenario) => (
                        <div key={scenario.scenario_id} className="p-4 rounded-lg bg-muted/30 border border-border">
                          <h4 className="font-medium mb-1">{scenario.label}</h4>
                          <p className="text-xs text-muted-foreground mb-3">{scenario.description}</p>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {Object.entries(scenario.multipliers).map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span className="text-muted-foreground">
                                  {key.replace(/_multiplier/g, '').replace(/_/g, ' ')}
                                </span>
                                <span className={`font-mono ${value > 1 ? 'text-warning' : 'text-success'}`}>
                                  {value}x
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {/* Empty state when no run yet */}
            {!hasRunOptimizer && !result && (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
                <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Ready to Optimize</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Configure your position size, rebalance frequency, and hedge duration on the left,
                  then click "Run Optimizer" to find the best strategy.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Optimizer;
