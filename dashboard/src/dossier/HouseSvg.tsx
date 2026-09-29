/**
 * The 2.5D house (spec §9 low tier, and the first paint before the 3D house loads):
 * an isometric SVG with the same temperature rim glow and scale as the 3D one.
 */
import { useId } from 'react';

interface HouseSvgProps {
  scale: number;
  rim: [number, number, number];
  lean: number;
  dark: boolean;
  ghostScale?: number | null;
  className?: string;
}

type P3 = [number, number, number];

export function HouseSvg({ scale, rim, lean, dark, ghostScale = null, className = '' }: HouseSvgProps) {
  const id = useId();
  const glow = `rgb(${rim.join(',')})`;
  const pal = dark
    ? { plotTop: '#0F1629', plotSide: '#0A0F1D', wallL: '#18203A', wallR: '#111831', roof: '#232E4F', gable: '#141C34', chimney: '#1A2340', window: '#FFD9A0', door: '#0B101F', line: glow, lineOpacity: 0.55 }
    : { plotTop: '#E8E4DA', plotSide: '#D6D1C6', wallL: '#FBFAF7', wallR: '#E6E2DA', roof: '#F2EFE9', gable: '#E1DDD4', chimney: '#EDEAE3', window: '#57534B', door: '#57534B', line: '#2a2620', lineOpacity: 0.45 };

  const house = (s: number, ghost: boolean, key: string) => {
    const u = 26 * s;
    const W = 5.2 * u;
    const D = 3.6 * u;
    const H = 2.5 * u;
    const R = 1.9 * u;
    const m = 1.3 * u;
    const t = 0.35 * u;
    // Centered on (0, 0): shift the isometric footprint's middle to the origin.
    const iso = ([X, Y, Z]: P3): [number, number] => [(X - W / 2 - (Y - D / 2)) * 0.866, (X - W / 2 + (Y - D / 2)) * 0.5 - Z + H * 0.4];
    const poly = (pts: P3[], fill: string, extra: Record<string, string | number> = {}) => (
      <path
        d={`M${pts.map((p) => iso(p).map((v) => v.toFixed(1)).join(',')).join('L')}Z`}
        fill={ghost ? 'none' : fill}
        stroke={ghost ? pal.line : pal.line}
        strokeOpacity={ghost ? 0.55 : pal.lineOpacity}
        strokeWidth={ghost ? 1.1 : 0.8}
        strokeDasharray={ghost ? '4 4' : undefined}
        strokeLinejoin="round"
        {...extra}
      />
    );
    const win = (pts: P3[], k: string) =>
      ghost ? (
        <g key={k}>{poly(pts, 'none')}</g>
      ) : (
        <g key={k}>
          {dark && poly(pts, '#FFB86B', { filter: `url(#${id}-soft)`, opacity: 0.85 })}
          {poly(pts, pal.window)}
        </g>
      );
    const cx = 1.1 * u;
    const cw = 0.6 * u;
    const cy0 = D * 0.18;
    const ch = H + R + 0.7 * u;
    const e = 0.25 * u;
    return (
      <g key={key}>
        {!ghost && (
          <>
            {poly([[-m, -m, 0], [W + m, -m, 0], [W + m, D + m, 0], [-m, D + m, 0]], pal.plotTop)}
            {poly([[-m, D + m, 0], [W + m, D + m, 0], [W + m, D + m, -t], [-m, D + m, -t]], pal.plotSide)}
            {poly([[W + m, -m, 0], [W + m, D + m, 0], [W + m, D + m, -t], [W + m, -m, -t]], pal.plotSide)}
          </>
        )}
        {poly([[0, D, 0], [W, D, 0], [W, D, H], [0, D, H]], pal.wallL)}
        {poly([[W, 0, 0], [W, D, 0], [W, D, H], [W, 0, H]], pal.wallR)}
        {poly([[W, 0, H], [W, D, H], [W, D / 2, H + R]], pal.gable)}
        {poly([[cx, cy0 + cw, H + R * 0.35], [cx + cw, cy0 + cw, H + R * 0.35], [cx + cw, cy0 + cw, ch], [cx, cy0 + cw, ch]], pal.chimney)}
        {poly([[cx + cw, cy0, H + R * 0.35], [cx + cw, cy0 + cw, H + R * 0.35], [cx + cw, cy0 + cw, ch], [cx + cw, cy0, ch]], pal.chimney)}
        {poly([[-e, D + e, H - e * 0.4], [W + e, D + e, H - e * 0.4], [W + e, D / 2, H + R], [-e, D / 2, H + R]], pal.roof)}
        {win([[0.5 * u, D, 0.9 * u], [1.6 * u, D, 0.9 * u], [1.6 * u, D, 1.9 * u], [0.5 * u, D, 1.9 * u]], 'w1')}
        {win([[3.6 * u, D, 0.9 * u], [4.7 * u, D, 0.9 * u], [4.7 * u, D, 1.9 * u], [3.6 * u, D, 1.9 * u]], 'w2')}
        {poly([[2.2 * u, D, 0], [2.8 * u, D, 0], [2.8 * u, D, 1.6 * u], [2.2 * u, D, 1.6 * u]], pal.door)}
        {win([[W, 0.8 * u, 0.9 * u], [W, 2.8 * u, 0.9 * u], [W, 2.8 * u, 1.9 * u], [W, 0.8 * u, 1.9 * u]], 'w3')}
      </g>
    );
  };

  return (
    <svg viewBox="-260 -230 520 400" className={className} aria-hidden="true" focusable="false">
      <defs>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
      </defs>
      <ellipse cx="-40" cy="-30" rx="170" ry="120" fill={glow} opacity={(dark ? 0.12 : 0.1) + 0.2 * lean} filter={`url(#${id}-glow)`} />
      {ghostScale != null && house(ghostScale, true, 'ghost')}
      {house(scale, false, 'house')}
    </svg>
  );
}
