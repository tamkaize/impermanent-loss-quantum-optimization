import { Scenario } from '@/types';
import { Sun, CloudLightning } from 'lucide-react';

interface ScenarioSelectorProps {
  scenarios: Scenario[];
  selected: string;
  onSelect: (scenarioId: string) => void;
}

export const ScenarioSelector = ({ scenarios, selected, onSelect }: ScenarioSelectorProps) => {
  const getIcon = (scenarioId: string) => {
    if (scenarioId === 'CALM') return Sun;
    return CloudLightning;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Market Scenario</h3>
      <div className="space-y-2">
        {scenarios.map((scenario) => {
          const Icon = getIcon(scenario.scenario_id);
          const isSelected = selected === scenario.scenario_id;
          
          return (
            <button
              key={scenario.scenario_id}
              onClick={() => onSelect(scenario.scenario_id)}
              className={`w-full p-4 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/10 glow-primary'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  isSelected ? 'bg-primary/20' : 'bg-muted'
                }`}>
                  <Icon className={`w-5 h-5 ${
                    isSelected ? 'text-primary' : 'text-muted-foreground'
                  }`} />
                </div>
                <div>
                  <div className="font-medium">{scenario.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {scenario.description}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
