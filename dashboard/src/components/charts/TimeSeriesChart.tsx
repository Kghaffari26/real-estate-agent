/**
 * Recharts line/area chart used everywhere a series is plotted. Lazy-loaded (see
 * ./index.tsx). One y-axis only, by design: second measures get their own synced
 * strip (RateStrip) or an indexed-to-100 comparison.
 */
import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Customized, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import { formatAxis, formatMonth, formatMonthTick, formatValue, type Scale } from '../../lib/format';
import type { Row } from '../../lib/series';
import { color, type ColorToken } from '../../lib/tokens';
import { endLabelMargin, extremes, resolveLabelCollisions } from './chartUtils';

export interface ChartSeries {
  key: string;
  label: string;
  /** Short name for the direct end label (defaults to label). */
  shortLabel?: string;
  color: ColorToken;
  dashed?: boolean;
}

export interface AxisSpec {
  format: string;
  scale?: Scale;
}

export interface TimeSeriesChartProps {
  rows: readonly Row[];
  series: readonly ChartSeries[];
  axis: AxisSpec;
  description: string;
  height?: number;
  syncId?: string;
  /** Soft gradient under a single series. */
  area?: boolean;
  /** Mark the visible high and low and the latest point (single series). */
  annotate?: boolean;
  /** Label for the high/low marks, e.g. "36-mo high". */
  extremeLabel?: { high: string; low: string };
  hideXAxis?: boolean;
  tooltipDate?: (iso: string) => string;
  valueFormatter?: (v: number) => string;
}

type TooltipEntry = { dataKey?: string | number; value?: number | string; color?: string };

function ChartTooltip({ active, payload, label, series, fmt, dateFmt }: { active?: boolean; payload?: TooltipEntry[]; label?: string; series: readonly ChartSeries[]; fmt: (v: number) => string; dateFmt: (iso: string) => string }) {
  if (!active || !payload?.length || !label) return null;
  const rows = series
    .map((s) => ({ s, v: payload.find((p) => p.dataKey === s.key)?.value }))
    .filter((r): r is { s: ChartSeries; v: number } => typeof r.v === 'number');
  if (!rows.length) return null;
  return (
    <div className="min-w-[160px] rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-2">
      <p className="mb-1.5 font-medium text-text-2">{dateFmt(label)}</p>
      <ul className="space-y-1">
        {rows.map(({ s, v }) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-text-2">
              <span className="h-2 w-2 rounded-full" style={{ background: color(s.color) }} aria-hidden="true" />
              {s.label}
            </span>
            <span className="num font-semibold text-text">{fmt(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface GraphicalItem {
  props?: { points?: { x: number; y: number | null; value?: unknown }[] };
  item?: { props?: { dataKey?: string } };
}

/** Direct labels at each line's last point, nudged apart; text in ink, dot in series color. */
function EndLabels(props: { formattedGraphicalItems?: GraphicalItem[]; offset?: { top: number; height: number }; series: readonly ChartSeries[]; fmt: (v: number) => string; single: boolean }) {
  const { formattedGraphicalItems = [], offset, series, fmt, single } = props;
  const ends = series
    .map((s) => {
      // The Area and the Line share a dataKey; only the Line's points carry scalar values.
      const pts =
        formattedGraphicalItems
          .filter((g) => g.item?.props?.dataKey === s.key && Array.isArray(g.props?.points))
          .map((g) => (g.props?.points ?? []).filter((p) => typeof p.y === 'number' && typeof p.value === 'number'))
          .find((list) => list.length > 0) ?? [];
      const last = pts[pts.length - 1];
      return last ? { s, x: last.x, y: last.y as number, value: last.value as number } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (!ends.length || !offset) return null;
  const ys = resolveLabelCollisions(ends.map((e) => e.y), 14, offset.top + 6, offset.top + offset.height - 4);
  return (
    <g aria-hidden="true">
      {ends.map((e, i) => (
        <g key={e.s.key}>
          <circle cx={e.x} cy={e.y} r={4} fill={color(e.s.color)} stroke={color('surface')} strokeWidth={2} />
          <text x={e.x + 9} y={ys[i]} dy="0.32em" fontSize={11} fontWeight={600} fill={color('text-2')} className="num">
            {single ? fmt(e.value) : (e.s.shortLabel ?? e.s.label)}
          </text>
        </g>
      ))}
    </g>
  );
}

export default function TimeSeriesChart({
  rows,
  series,
  axis,
  description,
  height = 300,
  syncId,
  area,
  annotate,
  extremeLabel = { high: 'High', low: 'Low' },
  hideXAxis,
  tooltipDate = (d) => formatMonth(d, true),
  valueFormatter,
}: TimeSeriesChartProps) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  const fmt = valueFormatter ?? ((v: number) => (axis.format === 'index' ? v.toFixed(1) : formatValue(v, axis.format, { scale: axis.scale })));
  const single = series.length === 1;
  const endLabels = series.length <= 4;
  const labelWidth = endLabelMargin(series);
  const ext = single && annotate ? extremes(rows, series[0]!.key) : null;
  const main = series[0];

  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{description}</figcaption>
      <div role="img" aria-label={description} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows as Row[]} syncId={syncId} margin={{ top: 12, right: endLabels ? labelWidth : 12, bottom: hideXAxis ? 0 : 4, left: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: color(s.color), stopOpacity: 0.18 }} />
                  <stop offset="100%" style={{ stopColor: color(s.color), stopOpacity: 0 }} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={color('grid')} vertical={false} />
            <XAxis
              dataKey="date"
              hide={hideXAxis}
              tickFormatter={formatMonthTick}
              stroke={color('border')}
              tick={{ fill: color('axis'), fontSize: 11 }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              width={56}
              axisLine={false}
              tickLine={false}
              tick={{ fill: color('axis'), fontSize: 11 }}
              tickFormatter={(v: number) => formatAxis(v, axis.format, axis.scale)}
              domain={['auto', 'auto']}
              tickCount={5}
            />
            <Tooltip
              cursor={{ stroke: color('crosshair'), strokeWidth: 1, strokeDasharray: '3 3' }}
              content={<ChartTooltip series={series} fmt={fmt} dateFmt={tooltipDate} />}
              isAnimationActive={false}
            />
            {single && area && main && (
              <Area
                type="monotone"
                dataKey={main.key}
                stroke="none"
                fill={`url(#${gid}-${main.key})`}
                connectNulls
                isAnimationActive={!reduce}
                animationDuration={500}
                activeDot={false}
                tooltipType="none"
              />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color(s.color)}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: color('surface') }}
                connectNulls
                isAnimationActive={!reduce}
                animationDuration={500}
              />
            ))}
            {ext?.high && ext.high.index !== ext.latest?.index && (
              <ReferenceDot x={rows[ext.high.index]!.date} y={ext.high.value} r={3} fill={color('surface')} stroke={color('text-3')} strokeWidth={1.5} label={{ value: `${extremeLabel.high} ${fmt(ext.high.value)}`, position: ext.high.index > rows.length * 0.75 ? 'left' : 'top', fontSize: 10, fill: color('text-3') }} />
            )}
            {ext?.low && ext.low.index !== ext.latest?.index && (
              <ReferenceDot x={rows[ext.low.index]!.date} y={ext.low.value} r={3} fill={color('surface')} stroke={color('text-3')} strokeWidth={1.5} label={{ value: `${extremeLabel.low} ${fmt(ext.low.value)}`, position: 'right', fontSize: 10, fill: color('text-3') }} />
            )}
            {endLabels && <Customized component={(p: object) => <EndLabels {...p} series={series} fmt={fmt} single={single} />} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
