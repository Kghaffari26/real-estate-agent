import { useEffect, useRef, useState } from 'react';
import { loadMetro } from '../../data/api';
import { numericSeries } from '../../lib/series';
import { Sparkline } from '../charts/Sparkline';

/**
 * A 24-month sparkline for one metro and metric. The index has no per-metro series,
 * so each row loads its metro file (cached) only once it scrolls into view.
 */
export function SparkCell({ slug, metric }: { slug: string; metric: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<(number | null)[] | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '1500px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    loadMetro(slug).then(
      (m) => live && setValues((numericSeries(m.series, metric) ?? []).slice(-24)),
      () => live && setValues([]),
    );
    return () => {
      live = false;
    };
  }, [visible, slug, metric]);

  return (
    <div ref={ref} className="h-6 w-20" aria-hidden="true">
      {values && values.length > 1 ? <Sparkline values={values} className="h-6 w-20" area={false} /> : <div className="h-6 w-20 rounded-sm bg-surface-3/60" />}
    </div>
  );
}
