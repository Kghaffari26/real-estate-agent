// SVG geometry for the Gate A frames: a tilted continental-U.S. map with light
// columns, an orthographic globe, an isometric house, and small charts.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoAlbersUsa, geoOrthographic, geoPath, geoTransform, geoCircle, geoContains, geoDistance, geoGraticule } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const json = (id) => JSON.parse(readFileSync(require.resolve(id), 'utf8'));
const usTopo = json('us-atlas/states-10m.json');
const worldTopo = json('world-atlas/land-110m.json');
export const states = feature(usTopo, usTopo.objects.states);
export const stateMesh = mesh(usTopo, usTopo.objects.states, (a, b) => a !== b);
export const nation = feature(usTopo, usTopo.objects.nation);
export const land = feature(worldTopo, worldTopo.objects.land);

// ---------- seeded randomness ----------
export function rng(seed = 7) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colour ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
/** Diverging: -1 → cool, 0 → mid, +1 → hot (piecewise through two steps each side). */
export function diverging(t, { cool2, cool1, mid, hot1, hot2 }) {
  const x = Math.max(-1, Math.min(1, t));
  if (x < 0) return x < -0.5 ? mix(cool1, cool2, (-x - 0.5) * 2) : mix(mid, cool1, -x * 2);
  return x > 0.5 ? mix(hot1, hot2, (x - 0.5) * 2) : mix(mid, hot1, x * 2);
}

// ---------- tilted map ----------
/**
 * A pitched, rotated Albers USA view: project, rotate by bearing, then apply a
 * simple perspective (points farther "north" on screen recede).
 */
export function tiltedMap({ cx, cy, scale = 1300, pitch = 45, bearing = -12, focal = 1500 }) {
  const base = geoAlbersUsa().scale(scale).translate([0, 0]);
  const b = (bearing * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const tf = (x, y) => {
    const xr = x * Math.cos(b) - y * Math.sin(b);
    const yr = x * Math.sin(b) + y * Math.cos(b);
    const s = focal / (focal + yr * Math.sin(p));
    return [cx + xr * s, cy + yr * Math.cos(p) * s, s];
  };
  const post = geoTransform({
    point(x, y) {
      const [a, c] = tf(x, y);
      this.stream.point(a, c);
    },
  });
  const projection = { stream: (s) => base.stream(post.stream(s)) };
  return {
    path: geoPath(projection),
    point: (lon, lat) => {
      const q = base([lon, lat]);
      return q ? tf(q[0], q[1]) : null;
    },
    circle: (lon, lat, miles) => geoPath(projection)(geoCircle().center([lon, lat]).radius(miles / 69.047).precision(2)()),
  };
}

/**
 * Light columns. `style`: 'glow' (A), 'clay' (B), 'line' (C).
 * items: [{x, y, s, h, color, id}]
 */
export function columns(items, style, opts = {}) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const out = [];
  for (const c of sorted) {
    const w = (opts.width ?? 7) * c.s;
    const h = c.h * c.s;
    const top = c.y - h;
    if (style === 'glow') {
      out.push(
        `<ellipse cx="${c.x}" cy="${c.y}" rx="${w * 2.2}" ry="${w * 0.8}" fill="${c.color}" opacity=".35" filter="url(#blur6)"/>`,
        `<rect x="${c.x - w / 2}" y="${top}" width="${w}" height="${h}" fill="url(#col-${c.id})"/>`,
        `<rect x="${c.x - w * 0.14}" y="${top}" width="${w * 0.28}" height="${h}" fill="#fff" opacity=".55"/>`,
        `<ellipse cx="${c.x}" cy="${top}" rx="${w / 2}" ry="${w * 0.22}" fill="#fff" opacity=".9"/>`,
        `<ellipse cx="${c.x}" cy="${top}" rx="${w * 1.6}" ry="${w * 0.9}" fill="${c.color}" opacity=".55" filter="url(#blur4)"/>`,
      );
    } else if (style === 'clay') {
      const d = w * 0.55; // iso depth
      out.push(
        `<path d="M${c.x - w / 2},${c.y} l${h * 0.55},${-h * 0.12} l${w},0 l${-h * 0.55},${h * 0.12}z" fill="#2a2620" opacity=".10" filter="url(#blur2)"/>`,
        `<path d="M${c.x - w / 2},${c.y} v${-h} h${w} v${h}z" fill="#fbfaf7" stroke="#2a2620" stroke-opacity=".35" stroke-width=".6"/>`,
        `<path d="M${c.x + w / 2},${c.y} v${-h} l${d},${-d * 0.5} v${h}z" fill="#dcd8cf" stroke="#2a2620" stroke-opacity=".35" stroke-width=".6"/>`,
        `<path d="M${c.x - w / 2},${top} h${w} l${d},${-d * 0.5} h${-w}z" fill="${c.color}" stroke="#2a2620" stroke-opacity=".45" stroke-width=".6"/>`,
        `<rect x="${c.x - w / 2}" y="${top}" width="${w}" height="${Math.min(h, 6 * c.s + 2)}" fill="${c.color}" stroke="#2a2620" stroke-opacity=".35" stroke-width=".6"/>`,
        `<path d="M${c.x + w / 2},${top} l${d},${-d * 0.5} v${Math.min(h, 6 * c.s + 2)} l${-d},${d * 0.5}z" fill="${c.color}" opacity=".8"/>`,
      );
    } else {
      out.push(
        `<line x1="${c.x}" y1="${c.y}" x2="${c.x}" y2="${top}" stroke="${c.color}" stroke-width="${Math.max(1, 1.6 * c.s)}"/>`,
        `<rect x="${c.x - 2.2}" y="${top - 2.2}" width="4.4" height="4.4" fill="${c.color}"/>`,
        `<line x1="${c.x - 3}" y1="${c.y}" x2="${c.x + 3}" y2="${c.y}" stroke="${c.color}" stroke-opacity=".6"/>`,
      );
    }
  }
  return out.join('');
}
export function columnGradients(items) {
  return items
    .map(
      (c) =>
        `<linearGradient id="col-${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.color}" stop-opacity="1"/><stop offset=".7" stop-color="${c.color}" stop-opacity=".55"/><stop offset="1" stop-color="${c.color}" stop-opacity=".08"/></linearGradient>`,
    )
    .join('');
}
export const commonFilters = `
  <filter id="blur2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
  <filter id="blur4" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="blur6" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="blur18" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="blur40" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="40"/></filter>`;

// ---------- globe ----------
const dotCache = new Map();
export function globe({ cx, cy, r, center = [-98, 38], tilt = 0, step = 1.6 }) {
  const proj = geoOrthographic().scale(r).translate([cx, cy]).rotate([-center[0], -center[1], tilt]).clipAngle(90);
  const key = `${center}|${step}`;
  if (!dotCache.has(key)) {
    const dots = [];
    for (let lat = -80; lat <= 84; lat += step) {
      const lonStep = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
      for (let lon = -180; lon < 180; lon += lonStep) {
        if (geoDistance([lon, lat], center) > Math.PI / 2 - 0.02) continue;
        if (!geoContains(land, [lon, lat])) continue;
        dots.push({ lon, lat, us: geoContains(nation, [lon, lat]) });
      }
    }
    dotCache.set(key, dots);
  }
  const dots = dotCache.get(key).map((d) => {
    const [x, y] = proj([d.lon, d.lat]);
    // Fade toward the limb.
    const edge = 1 - geoDistance([d.lon, d.lat], center) / (Math.PI / 2);
    return { x, y, us: d.us, edge };
  });
  const lift = (lon, lat, h) => {
    const p2 = geoOrthographic().scale(r * (1 + h)).translate([cx, cy]).rotate([-center[0], -center[1], tilt]);
    return p2([lon, lat]);
  };
  const path = geoPath(proj);
  return { proj, dots, lift, path, graticule: path(geoGraticule().step([15, 15])()), sphere: path({ type: 'Sphere' }) };
}

// ---------- isometric house ----------
/**
 * A stylised house: plot slab, two visible walls, gable roof, chimney, windows.
 * p: palette {plotTop, plotSide, wallL, wallR, roofL, gable, chimney, window, windowGlow, line, lineOpacity}
 */
export function house({ x, y, size = 1, p, ghost = false, windowsLit = true }) {
  const u = 26 * size; // unit
  const W = 5.2 * u; // width (x)
  const D = 3.6 * u; // depth (y)
  const H = 2.5 * u; // wall height
  const R = 1.9 * u; // roof rise
  const iso = (X, Y, Z) => [x + (X - Y) * 0.866, y + (X + Y) * 0.5 - Z];
  const poly = (pts, fill, extra = '') =>
    `<path d="M${pts.map((q) => iso(...q).map((v) => v.toFixed(1)).join(',')).join('L')}Z" fill="${ghost ? 'none' : fill}" ${
      ghost
        ? `stroke="${p.line}" stroke-opacity=".55" stroke-width="1.1" stroke-dasharray="4 4"`
        : `stroke="${p.line}" stroke-opacity="${p.lineOpacity ?? 0.35}" stroke-width=".8" stroke-linejoin="round"`
    } ${extra}/>`;
  const o = [];
  const m = 1.3 * u;
  const t = 0.35 * u;
  // centre the footprint on (x, y)
  const sx = -(W - D) * 0.866 * 0; // footprint already centred by caller offset
  void sx;
  if (!ghost) {
    o.push(poly([[-m, -m, 0], [W + m, -m, 0], [W + m, D + m, 0], [-m, D + m, 0]], p.plotTop));
    o.push(poly([[-m, D + m, 0], [W + m, D + m, 0], [W + m, D + m, -t], [-m, D + m, -t]], p.plotSide));
    o.push(poly([[W + m, -m, 0], [W + m, D + m, 0], [W + m, D + m, -t], [W + m, -m, -t]], p.plotSide2 ?? p.plotSide));
    // path to the door
    o.push(poly([[2.1 * u, D, 0.01], [2.9 * u, D, 0.01], [2.9 * u, D + m, 0.01], [2.1 * u, D + m, 0.01]], p.path ?? p.plotSide));
  }
  // walls: front (y = D) and right (x = W)
  o.push(poly([[0, D, 0], [W, D, 0], [W, D, H], [0, D, H]], p.wallL));
  o.push(poly([[W, 0, 0], [W, D, 0], [W, D, H], [W, 0, H]], p.wallR));
  // gable on the right wall
  o.push(poly([[W, 0, H], [W, D, H], [W, D / 2, H + R]], p.gable ?? p.wallR));
  // chimney (behind the ridge on the back slope, drawn before the front roof)
  const cxs = 1.1 * u;
  const cw = 0.6 * u;
  const cy0 = D * 0.18;
  const ch = H + R + 0.7 * u;
  o.push(poly([[cxs, cy0 + cw, H + R * 0.35], [cxs + cw, cy0 + cw, H + R * 0.35], [cxs + cw, cy0 + cw, ch], [cxs, cy0 + cw, ch]], p.chimney));
  o.push(poly([[cxs + cw, cy0, H + R * 0.35], [cxs + cw, cy0 + cw, H + R * 0.35], [cxs + cw, cy0 + cw, ch], [cxs + cw, cy0, ch]], p.chimneySide ?? p.chimney));
  o.push(poly([[cxs, cy0, ch], [cxs + cw, cy0, ch], [cxs + cw, cy0 + cw, ch], [cxs, cy0 + cw, ch]], p.roofL));
  // front roof slope with eaves
  const e = 0.25 * u;
  o.push(poly([[-e, D + e, H - e * 0.4], [W + e, D + e, H - e * 0.4], [W + e, D / 2, H + R], [-e, D / 2, H + R]], p.roofL));
  // windows
  const win = (pts) => {
    if (ghost) return poly(pts, 'none');
    return `${windowsLit ? poly(pts, p.windowGlow, 'filter="url(#blur4)" opacity=".85"') : ''}${poly(pts, p.window)}`;
  };
  // front wall: two windows + door
  o.push(win([[0.5 * u, D, 0.9 * u], [1.6 * u, D, 0.9 * u], [1.6 * u, D, 1.9 * u], [0.5 * u, D, 1.9 * u]]));
  o.push(win([[3.6 * u, D, 0.9 * u], [4.7 * u, D, 0.9 * u], [4.7 * u, D, 1.9 * u], [3.6 * u, D, 1.9 * u]]));
  o.push(poly([[2.2 * u, D, 0], [2.8 * u, D, 0], [2.8 * u, D, 1.6 * u], [2.2 * u, D, 1.6 * u]], ghost ? 'none' : p.door ?? p.window));
  // right wall: one wide window + gable window
  o.push(win([[W, 0.8 * u, 0.9 * u], [W, 2.8 * u, 0.9 * u], [W, 2.8 * u, 1.9 * u], [W, 0.8 * u, 1.9 * u]]));
  o.push(win([[W, D / 2 - 0.35 * u, H + 0.35 * u], [W, D / 2 + 0.35 * u, H + 0.35 * u], [W, D / 2 + 0.35 * u, H + 1.05 * u], [W, D / 2 - 0.35 * u, H + 1.05 * u]]));
  return { svg: o.join(''), width: (W + D) * 0.866 + 2 * m, height: H + R + (W + D) * 0.5 };
}

/** Iso blocks stacked on a plate: [{value, fill, label}], heights ∝ value. */
export function isoStack({ x, y, items, unit, w = 70, d = 70, p }) {
  const iso = (X, Y, Z) => [x + (X - Y) * 0.866, y + (X + Y) * 0.5 - Z];
  const poly = (pts, fill) =>
    `<path d="M${pts.map((q) => iso(...q).map((v) => v.toFixed(1)).join(',')).join('L')}Z" fill="${fill}" stroke="${p.line}" stroke-opacity="${p.lineOpacity ?? 0.35}" stroke-width=".8" stroke-linejoin="round"/>`;
  const o = [];
  let z = 0;
  const tops = [];
  for (const it of items) {
    const h = it.value * unit;
    o.push(poly([[0, d, z], [w, d, z], [w, d, z + h], [0, d, z + h]], it.front));
    o.push(poly([[w, 0, z], [w, d, z], [w, d, z + h], [w, 0, z + h]], it.side));
    o.push(poly([[0, 0, z + h], [w, 0, z + h], [w, d, z + h], [0, d, z + h]], it.top));
    tops.push({ ...it, anchor: iso(w, d / 2, z + h / 2), z0: z, z1: z + h });
    z += h + 3;
  }
  return { svg: o.join(''), tops, iso };
}

// ---------- charts ----------
export function linePath(values, { x0, y0, w, h, min, max }) {
  const n = values.length;
  const lo = min ?? Math.min(...values.filter((v) => v != null));
  const hi = max ?? Math.max(...values.filter((v) => v != null));
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    const X = x0 + (i / (n - 1)) * w;
    const Y = y0 + h - ((v - lo) / (hi - lo || 1)) * h;
    d += `${pen ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`;
    pen = true;
  });
  const pt = (i) => [x0 + (i / (n - 1)) * w, y0 + h - ((values[i] - lo) / (hi - lo || 1)) * h];
  return { d, pt, lo, hi };
}
