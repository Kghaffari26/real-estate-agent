import { forwardRef, lazy, Suspense, useEffect, useState } from 'react';
import { hasWebGL } from '../lib/webgl';
import type { AtlasMapHandle, AtlasMapProps } from './AtlasMap';

export type { AtlasMapHandle, HoverInfo } from './AtlasMap';

const AtlasMapImpl = lazy(() => import('./AtlasMap'));
const Atlas2DImpl = lazy(() => import('./Atlas2D').then((m) => ({ default: m.Atlas2D })));

export type AtlasTier = 'high' | 'low';

type Props = Omit<AtlasMapProps, 'onFail' | 'onReady'> & {
  tier: AtlasTier;
  onModeChange?: (mode: '3d' | '2d', reason?: string) => void;
};

/**
 * The atlas canvas, chosen by capability: the 3D map (MapLibre + deck.gl, lazy) or,
 * with no WebGL, a failed basemap or the forced low tier, the designed 2D atlas.
 * `data-atlas-mode` / `data-atlas-reason` say which one is showing (tests read them).
 */
export const Atlas = forwardRef<AtlasMapHandle, Props>(function Atlas({ tier, onModeChange, ...props }, ref) {
  const [failure, setFailure] = useState<string | null>(() => (tier === 'low' ? 'low tier' : hasWebGL() ? null : 'WebGL is unavailable'));
  // Follow a tier change in place (e.g. `?tier=` edited on the same page); real failures stay.
  useEffect(() => {
    setFailure((f) => (tier === 'low' ? (f ?? 'low tier') : f === 'low tier' ? (hasWebGL() ? null : 'WebGL is unavailable') : f));
  }, [tier]);
  if (failure) {
    return (
      <div className="absolute inset-0" data-atlas-mode="2d" data-atlas-reason={failure}>
        <Suspense fallback={null}>
          <Atlas2DImpl
            columns={props.columns}
            selected={props.selected}
            ring={props.ring}
            pin={props.pin}
            label={props.label}
            onSelect={props.onSelect}
            onPickEmpty={props.onPickEmpty}
            onHover={props.onHover}
          />
        </Suspense>
      </div>
    );
  }
  return (
    <div className="absolute inset-0" data-atlas-mode="3d">
      <Suspense fallback={null}>
        <AtlasMapImpl
          ref={ref}
          {...props}
          onReady={() => onModeChange?.('3d')}
          onFail={(reason) => {
            setFailure(reason);
            onModeChange?.('2d', reason);
          }}
        />
      </Suspense>
    </div>
  );
});
