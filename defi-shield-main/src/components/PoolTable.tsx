import { Pool } from '@/types';
import { InfoTooltip, GLOSSARY } from './Tooltip';
import { Layers, Shield, Zap } from 'lucide-react';

interface PoolTableProps {
  pools: Pool[];
}

export const PoolTable = ({ pools }: PoolTableProps) => {
  const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const formatUsd = (value: number) => `$${value.toLocaleString()}`;
  const formatScore = (value: number) => value.toFixed(2);

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Pool</th>
            <th>
              <InfoTooltip content={GLOSSARY.tvl}>TVL</InfoTooltip>
            </th>
            <th colSpan={3} className="text-center border-l border-border">
              <div className="flex items-center gap-1 justify-center">
                <Layers className="w-3.5 h-3.5" />
                Rewards
              </div>
            </th>
            <th colSpan={2} className="text-center border-l border-border">
              <div className="flex items-center gap-1 justify-center">
                <Shield className="w-3.5 h-3.5" />
                Risk
              </div>
            </th>
            <th colSpan={3} className="text-center border-l border-border">
              <div className="flex items-center gap-1 justify-center">
                <Zap className="w-3.5 h-3.5" />
                Execution
              </div>
            </th>
          </tr>
          <tr className="text-xs">
            <th></th>
            <th></th>
            <th className="border-l border-border">
              <InfoTooltip content="Fee income from trades in the pool">Fee APR</InfoTooltip>
            </th>
            <th>
              <InfoTooltip content="Extra rewards like token incentives">Incentive APR</InfoTooltip>
            </th>
            <th>
              <InfoTooltip content="Base lending rate (for lending pools)">Base APR</InfoTooltip>
            </th>
            <th className="border-l border-border">
              <InfoTooltip content={GLOSSARY.il_risk_score}>IL Risk</InfoTooltip>
            </th>
            <th>
              <InfoTooltip content="How volatile the token prices are">Vol Score</InfoTooltip>
            </th>
            <th className="border-l border-border">
              <InfoTooltip content={GLOSSARY.gas}>Gas</InfoTooltip>
            </th>
            <th>
              <InfoTooltip content={GLOSSARY.slippage}>Slippage</InfoTooltip>
            </th>
            <th>
              <InfoTooltip content={GLOSSARY.mev_risk_score}>MEV Risk</InfoTooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr key={pool.pool_id}>
              <td>
                <div>
                  <div className="font-medium">{pool.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {pool.protocol} · {pool.chain}
                  </div>
                </div>
              </td>
              <td className="font-mono text-sm">{formatUsd(pool.tvl_usd)}</td>
              <td className="border-l border-border/50 font-mono text-sm status-positive">
                {formatPercent(pool.reward.fee_apr)}
              </td>
              <td className="font-mono text-sm status-positive">
                {formatPercent(pool.reward.incentive_apr)}
              </td>
              <td className="font-mono text-sm">
                {formatPercent(pool.reward.base_apr)}
              </td>
              <td className={`border-l border-border/50 font-mono text-sm ${
                pool.risk.il_risk_score > 0.7 ? 'status-negative' : 
                pool.risk.il_risk_score > 0.4 ? 'status-warning' : ''
              }`}>
                {formatScore(pool.risk.il_risk_score)}
              </td>
              <td className={`font-mono text-sm ${
                pool.risk.price_vol_score > 0.7 ? 'status-negative' : 
                pool.risk.price_vol_score > 0.4 ? 'status-warning' : ''
              }`}>
                {formatScore(pool.risk.price_vol_score)}
              </td>
              <td className="border-l border-border/50 font-mono text-sm">
                ${pool.execution.gas_cost_usd_per_rebalance}
              </td>
              <td className="font-mono text-sm">
                {pool.execution.slippage_bps_per_rebalance}bps
              </td>
              <td className={`font-mono text-sm ${
                pool.execution.mev_risk_score > 0.5 ? 'status-warning' : ''
              }`}>
                {formatScore(pool.execution.mev_risk_score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
