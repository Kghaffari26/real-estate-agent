/**
 * Dossier building blocks: the region plate (procedural, labelled Illustrative), the
 * house stage (3D when WebGL allows, the isometric SVG first and as the fallback),
 * and the temperature drivers.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuality } from '../hooks/useQuality';
import { hasWebGL } from '../lib/webgl';
import type { Driver, Region } from '../lib/dossier';
import { HouseSvg } from './HouseSvg';

const House3D = lazy(() => import('./House3D'));

// ---------- region plate ----------
const PLATE: Record<Region, { vx: number; warm: number; density: number; seed: number }> = {
  West: { vx: 0.72, warm: 0.35, density: 1.0, seed: 3 },
  Southwest: { vx: 0.6, warm: 0.7, density: 0.7, seed: 7 },
  Midwest: { vx: 0.5, warm: 0.45, density: 0.8, seed: 11 },
  South: { vx: 0.66, warm: 0.6, density: 0.9, seed: 13 },
  Northeast: { vx: 0.78, warm: 0.4, density: 1.25, seed: 17 },
};

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An abstract "night grid" for the metro's region (one per region, not per city, so it
 * never poses as a photo of a real place): a receding street grid and scattered lights.
 */
export function RegionPlate({ region, dark }: { region: Region | null; dark: boolean }) {
  const p = PLATE[region ?? 'Midwest'];
  const W = 1440;
  const H = 640;
  const content = useMemo(() => {
    const r = rng(p.seed);
    const vx = W * p.vx;
    const vy = 120;
    const lines: string[] = [];
    for (let i = -34; i <= 34; i++) lines.push(`M${vx},${vy}L${vx + i * 90},${H}`);
    const rows: Array<{ y: number; o: number }> = [];
    for (let k = 1; k < 18; k++) rows.push({ y: vy + (H - vy) * (k / 18) ** 1.9, o: 0.02 + 0.06 * (k / 18) });
    const lights: Array<{ x: number; y: number; r: number; warm: boolean; o: number }> = [];
    for (let i = 0; i < 620 * p.density; i++) {
      const t = r() ** 1.6;
      lights.push({ y: vy + (H - vy) * t, x: vx + (r() - 0.5) * (220 + 2800 * t), r: 0.3 + t * 1.9, warm: r() < p.warm, o: 0.12 + r() * 0.55 });
    }
    return { lines, rows, lights };
  }, [p]);
  const grid = dark ? '#7FB2FF' : '#3A4458';
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path d={content.lines.join('')} stroke={grid} strokeOpacity={dark ? 0.07 : 0.06} fill="none" />
      {content.rows.map((row, i) => (
        <line key={i} x1="0" x2={W} y1={row.y} y2={row.y} stroke={grid} strokeOpacity={row.o * (dark ? 1 : 0.8)} />
      ))}
      {content.lights.map((l, i) => (
        <circle key={i} cx={l.x} cy={l.y} r={l.r} fill={l.warm ? (dark ? '#FFB86B' : '#D9803F') : dark ? '#9FD0FF' : '#4F7CC2'} opacity={dark ? l.o : l.o * 0.55} />
      ))}
    </svg>
  );
}

// ---------- house stage ----------
interface StageProps {
  scale: number;
  rim: [number, number, number];
  lean: number;
  dark: boolean;
  animate: boolean;
  ghostScale?: number | null;
  className?: string;
}

/** The 3D house when WebGL allows (lazy), with the SVG house painted first and kept as the fallback. */
export function HouseStage({ className = '', ...p }: StageProps) {
  const [ready, setReady] = useState(false);
  const quality = useQuality();
  const webgl = useMemo(() => quality.webgl && hasWebGL(), [quality.webgl]);
  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? '' : 'relative'} ${className}`} data-house-mode={webgl ? '3d' : '2d'}>
      <HouseSvg scale={p.scale} rim={p.rim} lean={p.lean} dark={p.dark} ghostScale={p.ghostScale} className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${ready ? 'opacity-0' : 'opacity-100'}`} />
      {webgl && (
        <Suspense fallback={null}>
          <div className={`absolute inset-0 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}>
            <House3D {...p} dpr={quality.dpr} onReady={() => setReady(true)} />
          </div>
        </Suspense>
      )}
    </div>
  );
}

// ---------- temperature drivers ----------
export function Drivers({ drivers }: { drivers: readonly Driver[] }) {
  if (!drivers.length) return <p className="text-sm text-mp-ink-2">Not enough components this month to compute a temperature.</p>;
  const max = Math.max(...drivers.map((d) => Math.abs(d.value)), 1e-9);
  return (
    <ul className="space-y-2.5">
      {drivers.map((d) => (
        <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_52px] items-center gap-3 text-sm">
          <span className="text-mp-ink">{d.label}</span>
          <span className="relative h-2.5" aria-hidden="true">
            <i className="absolute inset-y-[-4px] left-1/2 w-px bg-mp-ink/30" />
            <i
              className={`absolute inset-y-0 rounded-sm ${d.value < 0 ? 'bg-mp-cool-2' : 'bg-mp-hot-2'}`}
              style={d.value < 0 ? { right: '50%', width: `${(Math.abs(d.value) / max) * 50}%` } : { left: '50%', width: `${(d.value / max) * 50}%` }}
            />
          </span>
          <span className="mp-num text-right text-xs text-mp-ink-2">
            {d.value > 0 ? '+' : d.value < 0 ? '−' : ''}
            {Math.abs(d.value).toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}
