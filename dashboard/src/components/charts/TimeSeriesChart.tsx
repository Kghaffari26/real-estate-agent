import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAxis, formatMonth, formatMonthTick, formatValue, type Scale } from '../../lib/format';
import type { Row } from '../../lib/series';
import { color, type ColorToken } from '../../lib/tokens';
import { EmptyState } from '../ui/StateViews';

export interface ChartSeries {
  key: string;
  label: string;
  color: ColorToken;
  axis?: 'left' | 'right';
  dashed?: boolean;
}

export interface AxisSpec {
  format: string;
  scale?: Scale;
  label?: string;
}

interface TimeSeriesChartProps {
  rows: readonly Row[];
  series: readonly ChartSeries[];
  left: AxisSpec;
  right?: AxisSpec;
  /** Accessible summary of what the chart shows. */
  description: string;
  height?: number;
  /** Tick style for the x axis: monthly data ("May '26") or weekly ("Sep 24, 2026" → month ticks too). */
  tooltipDate?: (iso: string) => string;
}

/** A line chart over dates, with an optional right axis. All colors come from tokens. */
export function TimeSeriesChart({ rows, series, left, right, description, height = 280, tooltipDate = (d) => formatMonth(d) }: TimeSeriesChartProps) {
  const hasAny = rows.some((row) => series.some((s) => typeof row[s.key] === 'number'));
  if (!hasAny) return <EmptyState>No data for this selection.</EmptyState>;
  const axisFor = (s: ChartSeries) => (s.axis === 'right' && right ? right : left);

  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{description}</figcaption>
      <div role="img" aria-label={description} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows as Row[]} margin={{ top: 8, right: right ? 4 : 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={color('chart-grid')} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatMonthTick}
              stroke={color('chart-axis')}
              tick={{ fill: color('chart-axis'), fontSize: 12 }}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              width={56}
              stroke={color('chart-axis')}
              tick={{ fill: color('chart-axis'), fontSize: 12 }}
              tickFormatter={(v: number) => formatAxis(v, left.format, left.scale)}
              domain={['auto', 'auto']}
            />
            {right && (
              <YAxis
                yAxisId="right"
                orientation="right"
                width={48}
                stroke={color('chart-axis')}
                tick={{ fill: color('chart-axis'), fontSize: 12 }}
                tickFormatter={(v: number) => formatAxis(v, right.format, right.scale)}
                domain={['auto', 'auto']}
              />
            )}
            <Tooltip
              contentStyle={{
                background: color('surface'),
                border: `1px solid ${color('border')}`,
                borderRadius: 'var(--radius-md)',
                color: color('text'),
              }}
              labelFormatter={(label: string) => tooltipDate(label)}
              formatter={(value: number, _name, item) => {
                const s = series.find((x) => x.key === item.dataKey);
                const axis = s ? axisFor(s) : left;
                return [axis.format === 'index' ? value.toFixed(1) : formatValue(value, axis.format, { scale: axis.scale }), s?.label ?? String(item.dataKey)];
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ color: color('text'), fontSize: 12 }} />}
            {series.map((s) => (
              <Line
                key={s.key}
                yAxisId={s.axis === 'right' && right ? 'right' : 'left'}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color(s.color)}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
