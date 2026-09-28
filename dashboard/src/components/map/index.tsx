import { lazy, Suspense, useState, type ReactNode } from 'react';
import { MapPinOff } from 'lucide-react';
import { useInView } from '../../hooks/useInView';
import { useIsDark, usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import { hasWebGL } from '../../lib/webgl';
import { Skeleton } from '../ui/Skeleton';
import type { MetroMapProps } from './MetroMap';

const MetroMapImpl = lazy(() => import('./MetroMap'));

export type { MapPoint } from './MetroMap';

interface LazyMetroMapProps extends Omit<MetroMapProps, 'dark' | 'reducedMotion' | 'onFail'> {
  /** Rendered instead of the map when WebGL or the basemap fails. */
  fallback: ReactNode;
}

/** The map, lazy-loaded; falls back to `fallback` (a table/list) if WebGL or tiles fail. */
export function MetroMap({ fallback, ...props }: LazyMetroMapProps) {
  const dark = useIsDark();
  const reducedMotion = usePrefersReducedMotion();
  const [failure, setFailure] = useState<string | null>(null);
  // MapLibre is ~280 KB gz: load it (and probe WebGL) only when the map is about to be seen.
  const [ref, seen] = useInView<HTMLDivElement>('200px');
  const noWebGL = seen && !hasWebGL();
  if (noWebGL && !failure) setFailure('This browser has WebGL turned off');
  if (failure) {
    return (
      <div className="space-y-3">
        <p role="status" className="flex items-center gap-2 text-sm text-text-3">
          <MapPinOff aria-hidden="true" className="h-4 w-4" />
          Map unavailable ({failure}). Showing the list instead.
        </p>
        {fallback}
      </div>
    );
  }
  const placeholder = <Skeleton className={`w-full ${props.height ?? 'h-[360px] sm:h-[440px]'}`} />;
  return (
    <div ref={ref}>
      {seen ? (
        <Suspense fallback={placeholder}>
          <MetroMapImpl {...props} dark={dark} reducedMotion={reducedMotion} onFail={setFailure} />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  );
}
