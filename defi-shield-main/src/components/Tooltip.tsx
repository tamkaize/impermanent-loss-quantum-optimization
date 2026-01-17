import { ReactNode } from 'react';
import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';

interface TooltipProps {
  content: string;
  children?: ReactNode;
  showIcon?: boolean;
}

export const InfoTooltip = ({ content, children, showIcon = true }: TooltipProps) => {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-help">
          {children}
          {showIcon && <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
};

// Glossary of terms with simple explanations
export const GLOSSARY = {
  pool: "A place where you deposit your crypto to earn rewards. Think of it like a savings account, but for crypto.",
  hedge: "Protection against losses. Like insurance for your investment.",
  impermanent_loss: "When prices change, you might end up with less value than if you just held your crypto. It's temporary until you withdraw.",
  gas: "The fee you pay to use the blockchain. Like a transaction fee at a bank.",
  slippage: "The difference between the price you expect and what you actually get. Happens in busy markets.",
  mev: "When bots see your transaction and trade ahead of you to profit. Think of it like someone cutting in line.",
  apr: "Annual Percentage Rate - how much you earn per year, shown as a percentage.",
  tvl: "Total Value Locked - how much money is in a pool. Bigger usually means safer.",
  rebalance: "Adjusting your position to stay profitable. Like rebalancing a seesaw.",
  tenor: "How long the protection lasts. 7D = 7 days, 14D = 14 days, 30D = 30 days.",
  collar: "A type of hedge that limits both your losses AND gains. Cheaper than full protection.",
  protective_put: "Insurance that protects you if prices drop. Costs more but better protection.",
  il_risk_score: "A number from 0-1 showing how likely you are to experience impermanent loss. Higher = more risky.",
  mev_risk_score: "A number from 0-1 showing how likely bots are to trade against you. Higher = worse.",
  failure_prob: "The chance that a transaction fails and costs you gas without doing anything.",
};
