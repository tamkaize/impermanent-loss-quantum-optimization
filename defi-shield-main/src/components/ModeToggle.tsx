import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Atom, Cpu, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface ModeToggleProps {
  isApiMode: boolean;
  onToggle: (apiMode: boolean) => void;
  apiStatus: 'checking' | 'online' | 'offline';
}

export const ModeToggle = ({ isApiMode, onToggle, apiStatus }: ModeToggleProps) => {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Solver Mode</h3>
      <div className="p-4 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isApiMode ? (
              <Atom className="w-5 h-5 text-primary" />
            ) : (
              <Cpu className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <Label htmlFor="mode-toggle" className="font-medium">
                {isApiMode ? 'DIRAC-3 Quantum' : 'Mock Mode'}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isApiMode 
                  ? 'QCi HUBO/PUBO solver' 
                  : 'Classical heuristic solver'}
              </p>
            </div>
          </div>
          <Switch
            id="mode-toggle"
            checked={isApiMode}
            onCheckedChange={onToggle}
          />
        </div>

        {isApiMode && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 text-sm">
              {apiStatus === 'checking' && (
                <>
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  <span className="text-muted-foreground">Checking DIRAC-3...</span>
                </>
              )}
              {apiStatus === 'online' && (
                <>
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="text-success">DIRAC-3 Ready</span>
                </>
              )}
              {apiStatus === 'offline' && (
                <>
                  <XCircle className="w-4 h-4 text-destructive" />
                  <span className="text-destructive">Offline - will use Mock</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
