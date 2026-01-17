import { useState, useEffect } from 'react';
import { RebalanceBucket, TenorBucket, SelectedBuckets } from '@/types';
import { InfoTooltip, GLOSSARY } from './Tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BucketSelectorProps {
  selected: SelectedBuckets;
  onChange: (buckets: SelectedBuckets) => void;
  positionError: string | null;
  onPositionErrorChange: (error: string | null) => void;
}

const rebalanceBuckets: { value: RebalanceBucket; label: string; description: string }[] = [
  { value: 'daily', label: 'Daily', description: 'More gas, tighter control' },
  { value: 'weekly', label: 'Weekly', description: 'Balanced approach' },
  { value: 'monthly', label: 'Monthly', description: 'Less gas, more drift' },
];

const tenorBuckets: { value: TenorBucket; label: string; description: string }[] = [
  { value: '7D', label: '7 Days', description: 'Short-term protection' },
  { value: '14D', label: '14 Days', description: 'Standard protection' },
  { value: '30D', label: '30 Days', description: 'Extended protection' },
];

const formatCurrency = (value: number | null): string => {
  if (value === null || value === 0) return '';
  return value.toLocaleString('en-US');
};

const parseCurrency = (value: string): number | null => {
  if (value.trim() === '') return null;
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
};

export const BucketSelector = ({ 
  selected, 
  onChange, 
  positionError, 
  onPositionErrorChange 
}: BucketSelectorProps) => {
  const [inputValue, setInputValue] = useState(formatCurrency(selected.position_size_usd));

  useEffect(() => {
    // Only update if the external value changes significantly
    const currentParsed = parseCurrency(inputValue);
    if (selected.position_size_usd !== currentParsed) {
      setInputValue(formatCurrency(selected.position_size_usd));
    }
  }, [selected.position_size_usd]);

  const handlePositionChange = (value: string) => {
    setInputValue(value);
    
    const parsed = parseCurrency(value);
    
    // Clear error when user starts typing valid input
    if (parsed !== null && parsed > 0) {
      onPositionErrorChange(null);
      onChange({ ...selected, position_size_usd: parsed });
    } else if (value.trim() === '') {
      // Empty input - clear the position but don't show error yet (only on submit)
      onChange({ ...selected, position_size_usd: null as unknown as number });
    } else {
      // Invalid input - still update state but mark as invalid
      onChange({ ...selected, position_size_usd: null as unknown as number });
    }
  };

  const handleBlur = () => {
    const parsed = parseCurrency(inputValue);
    if (parsed !== null && parsed > 0) {
      setInputValue(formatCurrency(parsed));
    }
  };

  return (
    <div className="space-y-6">
      {/* Position Size Input */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Label htmlFor="position-size" className="text-sm font-medium">Position Size (USD)</Label>
          <InfoTooltip content="How much money you're putting in. This affects gas costs relative to your position and hedge pricing." />
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input
            id="position-size"
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={(e) => handlePositionChange(e.target.value)}
            onBlur={handleBlur}
            placeholder="Enter amount"
            className={`pl-7 font-mono ${positionError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
        </div>
        {positionError && (
          <p className="text-sm text-destructive mt-1">{positionError}</p>
        )}
      </div>

      {/* Rebalance Bucket */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-medium">Rebalance Frequency</h4>
          <InfoTooltip content={GLOSSARY.rebalance} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {rebalanceBuckets.map(({ value, label, description }) => (
            <button
              key={value}
              onClick={() => onChange({ ...selected, rebalance_bucket: value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                selected.rebalance_bucket === value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">{label}</div>
              <div className="text-xs text-muted-foreground mt-1">{description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tenor Bucket */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-medium">Hedge Duration</h4>
          <InfoTooltip content={GLOSSARY.tenor} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {tenorBuckets.map(({ value, label, description }) => (
            <button
              key={value}
              onClick={() => onChange({ ...selected, tenor_bucket: value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                selected.tenor_bucket === value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
            >
              <div className="font-medium text-sm">{label}</div>
              <div className="text-xs text-muted-foreground mt-1">{description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
