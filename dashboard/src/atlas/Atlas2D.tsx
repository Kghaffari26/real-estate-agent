/**
 * The designed 2D atlas (spec §9 low tier): no WebGL, a failed basemap, or `?tier=low`.
 * U.S. states from us-atlas (pre-projected Albers USA), metros as glowing dots sized
 * by the column height and colored like the columns, the search ring as a path.
 * Same selection and area-search interactions as the 3D map.
 */
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import states10m from 'us-atlas/states-albers-10m.json';
import { useMemo, type MouseEvent } from 'react';
import type { ColumnDatum } from '../viewmodels/atlas';

const topo = states10m as unknown as Topology;
const statesObj = topo.objects.states as GeometryCollection;
const land = geoPath()(feature(topo, statesObj)) ?? '';
const borders = geoPath()(mesh(topo, statesObj, (a, b) => a !== b)) ?? '';
// us-atlas' "albers" files are projected with this exact projection into 975×610.
const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);

interface Atlas2DProps {
  columns: readonly ColumnDatum[];
  selected: readonly string[];
  ring: Array<[number, number]> | null;
  pin: { lat: number; lon: number } | null;
  label: string;
  onSelect: (slug: string) => void;
  onPickEmpty: (lat: number, lon: number) => void;
  onHover: (info: { slug: string; x: number; y: number } | null) => void;
}

export function Atlas2D({ columns, selected, ring, pin, label, onSelect, onPickEmpty, onHover }: Atlas2DProps) {
  const ringPath = useMemo(() => (ring ? geoPath(projection)({ type: 'Polygon', coordinates: [ring] }) : null), [ring]);
  const sel = new Set(selected);
  const dots = columns
    .filter((c) => c.height != null)
    .map((c) => ({ c, p: projection([c.lon, c.lat]) }))
    .filter((d): d is { c: ColumnDatum; p: [number, number] } => d.p != null)
    .sort((a, b) => Math.abs(b.c.height ?? 0) - Math.abs(a.c.height ?? 0));
  const pinP = pin ? projection([pin.lon, pin.lat]) : null;

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const hit = (e.target as Element).closest('[data-slug]')?.getAttribute('data-slug');
    if (hit) return onSelect(hit);
    const ll = projection.invert?.([loc.x, loc.y]);
    if (ll) onPickEmpty(ll[1], ll[0]);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center px-4 pb-40 pt-24 md:px-[300px]">
      <svg viewBox="0 0 975 610" className="h-full max-h-[78vh] w-full" role="img" aria-label={label} onClick={onClick} onMouseLeave={() => onHover(null)}>
        <defs>
          <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <path d={land} style={{ fill: 'rgb(var(--mp-bg-2))' }} />
        <path d={borders} fill="none" style={{ stroke: 'rgb(var(--mp-accent) / .18)' }} strokeWidth="0.8" />
        {ringPath && <path d={ringPath} style={{ fill: 'rgb(var(--mp-accent) / .08)', stroke: 'rgb(var(--mp-accent))' }} strokeWidth="1.5" />}
        {dots.map(({ c, p }) => {
          // Area-true: radius ∝ √|height| (YoY heights are signed; color carries the sign).
          const r = 3 + Math.sqrt(Math.abs(c.height ?? 0)) * 11;
          const fill = `rgb(${c.color.join(',')})`;
          return (
            <g
              key={c.slug}
              data-slug={c.slug}
              className="cursor-pointer"
              onMouseMove={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).parentElement!.getBoundingClientRect();
                onHover({ slug: c.slug, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
            >
              <circle cx={p[0]} cy={p[1]} r={r * 1.8} fill={fill} opacity=".35" filter="url(#dot-glow)" />
              <circle cx={p[0]} cy={p[1]} r={r} fill={fill} opacity=".92" style={sel.has(c.slug) ? { stroke: 'rgb(var(--mp-accent))' } : { stroke: 'rgb(var(--mp-bg) / .6)' }} strokeWidth={sel.has(c.slug) ? 3 : 1} />
            </g>
          );
        })}
        {pinP && <circle cx={pinP[0]} cy={pinP[1]} r="4.5" style={{ fill: 'rgb(var(--mp-accent))' }} />}
      </svg>
    </div>
  );
}
