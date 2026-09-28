/** A short mortgage-rate strip that shares the x-axis and crosshair (syncId) with the chart above. */
import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { formatAxis, formatMonth, formatMonthTick, formatValue } from '../../lib/format';
import type { Row } from '../../lib/series';
import { color } from '../../lib/tokens';

export interface RateStripProps {
  rows: readonly Row[];
  dataKey: string;
  label: string;
  syncId: string;
  rightMargin: number;
  height?: number;
}

export default function RateStrip({ rows, dataKey, label, syncId, rightMargin, height = 96 }: RateStripProps) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  const fmt = (v: number) => formatValue(v, 'percent', { scale: 'points' });
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{`${label}, aligned to the same months`}</figcaption>
      <div className="flex items-center gap-2 pb-1 pl-14 text-xs text-text-3">
        <span className="h-0.5 w-3 rounded bg-cat-2" aria-hidden="true" />
        {label}
      </div>
      <div role="img" aria-label={`${label}, aligned to the same months`} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows as Row[]} syncId={syncId} margin={{ top: 4, right: rightMargin, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: color('cat-2'), stopOpacity: 0.2 }} />
                <stop offset="100%" style={{ stopColor: color('cat-2'), stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={color('grid')} vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatMonthTick} stroke={color('border')} tick={{ fill: color('axis'), fontSize: 11 }} tickLine={false} minTickGap={28} />
            <YAxis width={56} axisLine={false} tickLine={false} tick={{ fill: color('axis'), fontSize: 11 }} tickFormatter={(v: number) => formatAxis(v, 'percent', 'points')} domain={['auto', 'auto']} tickCount={3} />
            <Tooltip
              cursor={{ stroke: color('crosshair'), strokeWidth: 1, strokeDasharray: '3 3' }}
              content={({ active, payload, label: l }) =>
                active && payload?.length && typeof payload[0]?.value === 'number' ? (
                  <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-2">
                    <span className="text-text-3">{formatMonth(String(l), true)} · </span>
                    <span className="num font-semibold">{fmt(payload[0].value)}</span>
                  </div>
                ) : null
              }
              isAnimationActive={false}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color('cat-2')} strokeWidth={2} fill={`url(#${gid})`} connectNulls dot={false} isAnimationActive={!reduce} animationDuration={500} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
