/**
 * Lazy entry points. Recharts (~110 KB gz) loads only when a chart is about to
 * scroll into view, so the first paint doesn't pay for charts below the fold.
 */
import { lazy, Suspense } from 'react';
import { useInView } from '../../hooks/useInView';
import { ChartSkeleton } from '../ui/Skeleton';
import type { RateStripProps } from './RateStrip';
import type { TimeSeriesChartProps } from './TimeSeriesChart';

const TimeSeriesChartImpl = lazy(() => import('./TimeSeriesChart'));
const RateStripImpl = lazy(() => import('./RateStrip'));

export type { ChartSeries, AxisSpec } from './TimeSeriesChart';

export function TimeSeriesChart(props: TimeSeriesChartProps) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const height = props.height ?? 300;
  return (
    <div ref={ref}>
      {seen ? (
        <Suspense fallback={<ChartSkeleton height={height} />}>
          <TimeSeriesChartImpl {...props} />
        </Suspense>
      ) : (
        <ChartSkeleton height={height} />
      )}
    </div>
  );
}

export function RateStrip(props: RateStripProps) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const height = (props.height ?? 96) + 24;
  return (
    <div ref={ref}>
      {seen ? (
        <Suspense fallback={<ChartSkeleton height={height} />}>
          <RateStripImpl {...props} />
        </Suspense>
      ) : (
        <ChartSkeleton height={height} />
      )}
    </div>
  );
}
