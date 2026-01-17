import { useState, useEffect, useCallback } from 'react';
import { Pool, Hedges, Scenario, OptimizerResult, AppState } from '@/types';
import { seedPools, seedHedges, seedScenarios } from '@/data/seedData';

const STORAGE_KEY = 'kurtosis_labs_state';

const getInitialState = (): AppState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error loading state from localStorage:', e);
  }
  
  return {
    pools: seedPools,
    hedges: seedHedges,
    scenarios: seedScenarios,
    runs: []
  };
};

export const useAppState = () => {
  const [state, setState] = useState<AppState>(getInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Error saving state to localStorage:', e);
    }
  }, [state]);

  const setPools = useCallback((pools: Pool[]) => {
    setState(prev => ({ ...prev, pools }));
  }, []);

  const setHedges = useCallback((hedges: Hedges) => {
    setState(prev => ({ ...prev, hedges }));
  }, []);

  const setScenarios = useCallback((scenarios: Scenario[]) => {
    setState(prev => ({ ...prev, scenarios }));
  }, []);

  const addRun = useCallback((run: OptimizerResult) => {
    setState(prev => ({ ...prev, runs: [run, ...prev.runs] }));
  }, []);

  const importPools = useCallback((json: string) => {
    try {
      const pools = JSON.parse(json) as Pool[];
      setPools(pools);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Invalid JSON format' };
    }
  }, [setPools]);

  const importHedges = useCallback((json: string) => {
    try {
      const hedges = JSON.parse(json) as Hedges;
      setHedges(hedges);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Invalid JSON format' };
    }
  }, [setHedges]);

  const importScenarios = useCallback((json: string) => {
    try {
      const scenarios = JSON.parse(json) as Scenario[];
      setScenarios(scenarios);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Invalid JSON format' };
    }
  }, [setScenarios]);

  const exportPools = useCallback(() => {
    return JSON.stringify(state.pools, null, 2);
  }, [state.pools]);

  const exportHedges = useCallback(() => {
    return JSON.stringify(state.hedges, null, 2);
  }, [state.hedges]);

  const exportScenarios = useCallback(() => {
    return JSON.stringify(state.scenarios, null, 2);
  }, [state.scenarios]);

  const resetToDefaults = useCallback(() => {
    setState({
      pools: seedPools,
      hedges: seedHedges,
      scenarios: seedScenarios,
      runs: []
    });
  }, []);

  return {
    pools: state.pools,
    hedges: state.hedges,
    scenarios: state.scenarios,
    runs: state.runs,
    setPools,
    setHedges,
    setScenarios,
    addRun,
    importPools,
    importHedges,
    importScenarios,
    exportPools,
    exportHedges,
    exportScenarios,
    resetToDefaults
  };
};
