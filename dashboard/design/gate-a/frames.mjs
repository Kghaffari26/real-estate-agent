// The four Gate A key frames (Arrival, Explore, Dossier, Affordability) for a theme.
import * as D from './data.mjs';
import { tiltedMap, columns, columnGradients, commonFilters, globe, house, isoStack, linePath, diverging, rng, mix, states, stateMesh, nation } from './geo.mjs';
import { fontsHref } from './themes.mjs';

const W = 1440;
const H = 900;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------- icons (lucide geometry, 1.5 px stroke) ----------
const ic = (d, s = 16) =>
  `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  crosshair: '<circle cx="12" cy="12" r="9"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  compare: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  trendDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  trendUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  flat: '<path d="M4 12h16"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/>',
};

const divColor = (T, yoy) => diverging(yoy / D.yoyMaxAbs, T.div);
const tempColor = (T, score) => (score < 50 ? mix(T.div.mid, T.cold, (50 - score) / 50) : mix(T.div.mid, T.hot, (score - 50) / 50));

// ---------- page shell ----------
function page(T, frame, body, extraCss = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Gate A · ${T.name} · ${frame}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontsHref}" rel="stylesheet">
<style>
:root{--bg:${T.bg};--bg2:${T.bg2};--ink:${T.ink};--ink2:${T.ink2};--ink3:${T.ink3};--rule:${T.rule};--panel:${T.panel};--pb:${T.panelBorder};--ph:${T.panelHighlight};--acc:${T.accent};--acc-ink:${T.accentInk};
--display:${T.display};--ui:${T.ui};--mono:${T.mono};--rp:${T.radius.panel}px;--rc:${T.radius.control}px;--rchip:${T.radius.chip}px}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--ui);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.big{font-weight:${T.monoBig};letter-spacing:-.035em}
.label{font-family:var(--ui);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);font-weight:500}
.abs{position:absolute}
.ic{display:inline-block;vertical-align:-3px;flex:none}
.stage{position:absolute;inset:0}
.panel{position:absolute;background:var(--panel);border:1px solid var(--pb);border-radius:var(--rp);box-shadow:inset 0 1px 0 var(--ph)${T.blur ? `;backdrop-filter:blur(${T.blur}px) saturate(1.2)` : ''}}
.btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:var(--rc);font:500 14px var(--ui);color:var(--ink);border:1px solid var(--pb);background:transparent}
.btn.primary{background:var(--acc);color:var(--acc-ink);border-color:transparent}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:var(--rchip);font:500 12px var(--ui);border:1px solid var(--pb);color:var(--ink2);white-space:nowrap}
.pos{color:${T.div.hot2}} .neg{color:${T.div.cool2}}
.topbar{position:absolute;left:0;right:0;top:0;height:64px;display:flex;align-items:center;gap:20px;padding:0 28px;z-index:5}
.brand{display:flex;align-items:center;gap:10px;font:600 16px var(--ui);letter-spacing:-.01em}
.nav{display:flex;gap:4px;margin-left:18px}
.nav span{padding:6px 12px;border-radius:var(--rc);color:var(--ink2);font-size:14px}
.nav span.on{color:var(--ink);background:${T.dark ? 'rgba(255,255,255,.07)' : 'rgba(28,27,25,.06)'}}
.spacer{flex:1}
.kbd{font:500 11px var(--mono);padding:2px 6px;border:1px solid var(--pb);border-radius:4px;color:var(--ink3)}
.cmd{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 12px;width:280px;border-radius:var(--rc);border:1px solid var(--pb);background:var(--panel);color:var(--ink3);font-size:13px}
.iconbtn{width:36px;height:36px;display:grid;place-items:center;border-radius:var(--rc);border:1px solid var(--pb);color:var(--ink2);background:var(--panel)}
.fresh{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink2)}
.fresh i{width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 10px var(--acc)}
.attrib{position:absolute;font-size:11px;color:var(--ink3)}
${extraCss}
</style></head><body>${body}</body></html>`;
}

function logo(T) {
  const c = T.accent;
  return `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M6 15v-3M10 15V8M14 15v-5M18 15V6" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function topbar(T, active) {
  const items = ['Atlas', 'Brief', 'Compare', 'Method'];
  return `<header class="topbar">
  <div class="brand">${logo(T)}<span>Metro Pulse</span></div>
  <nav class="nav">${items.map((n) => `<span class="${n === active ? 'on' : ''}">${n}</span>`).join('')}</nav>
  <div class="spacer"></div>
  <div class="fresh"><i></i>${esc(D.freshness)}</div>
  <div class="cmd">${ic(I.search, 15)}<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Search metros, metrics…</span><span class="kbd">⌘K</span></div>
  <div class="iconbtn" title="Pause media">${ic(I.pause, 15)}</div>
  <div class="iconbtn" title="Theme">${ic(T.dark ? I.moon : I.sun, 15)}</div>
  <div class="iconbtn" title="Share">${ic(I.share, 15)}</div>
</header>`;
}

// ---------- backgrounds ----------
function starfield(n, seed, color = '#fff') {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * H;
    const a = 0.08 + r() ** 3 * 0.7;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.4 + r() * 0.9).toFixed(2)}" fill="${color}" opacity="${a.toFixed(2)}"/>`;
  }
  return s;
}
const grain = (opacity) =>
  `<svg class="abs" style="inset:0;pointer-events:none;mix-blend-mode:overlay;opacity:${opacity}" width="${W}" height="${H}" aria-hidden="true"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0"/></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>`;

// ---------- ARRIVAL ----------
export function arrival(T) {
  const cfg = {
    a: { cx: 1030, cy: 820, r: 600, center: [-97, 14] },
    b: { cx: 1060, cy: 900, r: 560, center: [-97, 12] },
    c: { cx: 1040, cy: 800, r: 560, center: [-97, 14] },
  }[T.id];
  const g = globe({ ...cfg, tilt: T.id === 'b' ? 0 : -6, step: T.id === 'c' ? 1.8 : 1.3 });
  const [pMin, pMax] = D.priceExtent;
  const norm = (p) => (p - pMin) / (pMax - pMin);
  const landColor = { a: '#34426A', b: '#B9B3A7', c: '#343434' }[T.id];
  const usColor = { a: '#6F8CC8', b: '#6A655B', c: T.accent };
  let dots = '';
  for (const d of g.dots) {
    const col = d.us ? usColor[T.id] : landColor;
    const op = (d.us ? 0.9 : 0.75) * (0.25 + 0.75 * d.edge);
    dots +=
      T.id === 'c'
        ? `<rect x="${(d.x - 1).toFixed(1)}" y="${(d.y - 1).toFixed(1)}" width="2" height="2" fill="${col}" opacity="${Math.min(1, op * (d.us ? 1.15 : 1.1)).toFixed(2)}"/>`
        : `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${T.id === 'b' ? 1.25 : 1.35}" fill="${col}" opacity="${op.toFixed(2)}"/>`;
  }
  // light columns
  let cols = '';
  const grads = [];
  if (T.id === 'b') {
    const items = D.metros.map((m, i) => {
      const [x, y] = g.proj([m.lon, m.lat]);
      return { x, y, s: 1, h: 16 + norm(m.price) * 120, color: divColor(T, m.yoy), id: `g${i}` };
    });
    cols = columns(items, 'clay', { width: 8 });
  } else {
    D.metros
      .map((m) => ({ m, base: g.proj([m.lon, m.lat]), top: g.lift(m.lon, m.lat, 0.03 + norm(m.price) * (T.id === 'c' ? 0.22 : 0.3)) }))
      .sort((a, b) => a.base[1] - b.base[1])
      .forEach(({ m, base, top }, i) => {
        const c = divColor(T, m.yoy);
        if (T.id === 'a') {
          grads.push(`<linearGradient id="gl${i}" gradientUnits="userSpaceOnUse" x1="${base[0]}" y1="${base[1]}" x2="${top[0]}" y2="${top[1]}"><stop offset="0" stop-color="${c}" stop-opacity=".1"/><stop offset=".6" stop-color="${c}" stop-opacity=".9"/><stop offset="1" stop-color="#fff"/></linearGradient>`);
          cols += `<line x1="${base[0]}" y1="${base[1]}" x2="${top[0]}" y2="${top[1]}" stroke="${c}" stroke-width="7" opacity=".28" filter="url(#blur4)"/>
<line x1="${base[0]}" y1="${base[1]}" x2="${top[0]}" y2="${top[1]}" stroke="url(#gl${i})" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="${top[0]}" cy="${top[1]}" r="6" fill="${c}" opacity=".6" filter="url(#blur4)"/><circle cx="${top[0]}" cy="${top[1]}" r="1.6" fill="#fff"/>`;
        } else {
          cols += `<line x1="${base[0]}" y1="${base[1]}" x2="${top[0]}" y2="${top[1]}" stroke="${c}" stroke-width="2"/><rect x="${top[0] - 2.5}" y="${top[1] - 2.5}" width="5" height="5" fill="${c}"/>`;
        }
      });
  }
  const atmo = {
    a: `<radialGradient id="atmo" cx="50%" cy="50%" r="50%"><stop offset=".78" stop-color="#5CE1E6" stop-opacity="0"/><stop offset=".86" stop-color="#5CE1E6" stop-opacity=".22"/><stop offset=".93" stop-color="#3D7BFF" stop-opacity=".08"/><stop offset="1" stop-color="#3D7BFF" stop-opacity="0"/></radialGradient>
       <radialGradient id="ocean" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#0E1630"/><stop offset="1" stop-color="#04060C"/></radialGradient>`,
    b: `<radialGradient id="ocean" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#FBFAF7"/><stop offset="1" stop-color="#E7E3DB"/></radialGradient>`,
    c: `<radialGradient id="ocean" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#050505"/><stop offset="1" stop-color="#000"/></radialGradient>`,
  }[T.id];
  const R2 = cfg.r * 1.18;
  const globeSvg = `<svg class="abs" style="inset:0" width="${W}" height="${H}" aria-hidden="true"><defs>${commonFilters}${atmo}${grads.join('')}
    <radialGradient id="bgGlow" cx="70%" cy="60%" r="60%"><stop offset="0" stop-color="${T.id === 'a' ? '#0F1A3A' : T.bg2}"/><stop offset="1" stop-color="${T.bg}"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="${T.id === 'b' ? T.bg : 'url(#bgGlow)'}"/>
    ${T.id === 'a' ? starfield(420, 3) : T.id === 'c' ? starfield(140, 9, '#FFB000') : ''}
    ${T.id === 'a' ? `<circle cx="${cfg.cx}" cy="${cfg.cy}" r="${R2}" fill="url(#atmo)"/>` : ''}
    ${T.id === 'b' ? `<ellipse cx="${cfg.cx + 60}" cy="${cfg.cy + cfg.r * 0.2}" rx="${cfg.r * 1.05}" ry="${cfg.r * 0.9}" fill="#2a2620" opacity=".10" filter="url(#blur40)"/>` : ''}
    <path d="${g.sphere}" fill="url(#ocean)" stroke="${T.id === 'a' ? 'rgba(92,225,230,.35)' : T.id === 'b' ? 'rgba(28,27,25,.55)' : 'rgba(255,176,0,.35)'}" stroke-width="${T.id === 'b' ? 1 : 1.2}"/>
    <path d="${g.graticule}" fill="none" stroke="${T.id === 'b' ? 'rgba(28,27,25,.10)' : T.id === 'c' ? 'rgba(255,255,255,.07)' : 'rgba(120,160,255,.06)'}" stroke-width="1"/>
    ${dots}${cols}
  </svg>`;

  const c1 = { label: 'U.S. median sale price', value: D.usdCompact(D.national.price), delta: D.pct(D.national.priceYoy), dl: 'YoY', sgn: D.national.priceYoy };
  const c2 = { label: '30-yr fixed rate', value: `${D.national.rate.toFixed(2)}%`, delta: D.pp(D.national.rate1w), dl: '1 wk', sgn: D.national.rate1w };
  const c3 = { label: 'Active inventory', value: D.countCompact(D.national.inventory), delta: D.pct(D.national.inventoryYoy), dl: 'YoY', sgn: D.national.inventoryYoy };
  const counters = [c1, c2, c3];

  if (T.id === 'a') {
    return page(
      T,
      'Arrival',
      `${globeSvg}${grain(0.18)}${topbar(T, '')}
<section class="abs" style="left:96px;top:150px;width:600px">
  <div class="label" style="color:var(--acc);margin-bottom:22px">The U.S. housing market · ${D.monthLabel(D.national.dataThrough, 'long')}</div>
  <h1 style="font:400 64px/1.02 var(--display);letter-spacing:-.015em">${esc(D.national.headline)}</h1>
  <div style="display:flex;gap:12px;margin-top:34px"><span class="btn primary" style="height:48px;padding:0 22px;font-size:15px">Enter the market ${ic(I.arrow, 16)}</span><span class="btn" style="height:48px;padding:0 20px">Read the brief ${ic(I.down, 16)}</span></div>
</section>
<section class="abs" style="left:96px;bottom:72px;display:flex;gap:56px">
  ${counters
    .map(
      (c) => `<div><div class="label">${c.label}</div><div class="num big" style="font-size:52px;line-height:1.05;margin-top:8px;font-weight:400">${c.value}</div>
  <div style="margin-top:6px;font-size:13px;color:var(--ink2)"><span class="num ${c.sgn > 0 ? 'pos' : 'neg'}">${c.delta}</span> <span>${c.dl}</span></div></div>`,
    )
    .join('')}
</section>
<div class="abs" style="right:40px;top:120px;text-align:right" ><div class="label">50 metros · columns</div><div style="font-size:12px;color:var(--ink3);margin-top:4px">height = median price · color = YoY</div></div>
<div class="attrib" style="right:40px;bottom:24px">Data: Redfin, Zillow, FRED, U.S. Census Bureau</div>`,
    );
  }
  if (T.id === 'b') {
    return page(
      T,
      'Arrival',
      `${globeSvg}${topbar(T, '')}
<section class="abs" style="left:64px;top:118px;width:980px">
  <div class="label" style="margin-bottom:18px;color:var(--ink2)"><span style="color:var(--acc)">●</span>&nbsp; Housing market · ${D.monthLabel(D.national.dataThrough, 'long')}</div>
  <h1 style="font:500 64px/1.0 var(--display);letter-spacing:-.035em;width:900px">${esc(D.national.headline)}</h1>
</section>
<section class="abs" style="left:64px;top:520px;width:360px">
  ${counters
    .map(
      (c) => `<div style="border-top:1px solid var(--ink);padding:12px 0 14px;display:grid;grid-template-columns:1fr auto;align-items:end"><div><div class="label" style="color:var(--ink2)">${c.label}</div><div class="num big" style="font-size:44px;line-height:1.05;margin-top:4px;font-weight:500">${c.value}</div></div><div class="num" style="font-size:14px;text-align:right">${c.delta}<div style="font:12px var(--ui);color:var(--ink3)">${c.dl}</div></div></div>`,
    )
    .join('')}
  <div style="display:flex;gap:10px;margin-top:14px"><span class="btn primary">Enter the market ${ic(I.arrow, 15)}</span><span class="btn">Read the brief</span></div>
</section>
<div class="attrib" style="left:64px;bottom:20px">Data: Redfin, Zillow, FRED, U.S. Census Bureau</div>
<div class="abs" style="right:40px;top:96px;text-align:right;font-size:12px;color:var(--ink2)">50 metros, clay columns<br>height = median price · top = YoY</div>`,
    );
  }
  // C
  const tick = [...D.metros].sort((a, b) => b.sold12 - a.sold12).slice(0, 26);
  return page(
    T,
    'Arrival',
    `${globeSvg}${topbar(T, '')}
<div class="abs" style="left:0;right:0;top:64px;height:30px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:22px;padding:0 28px;overflow:hidden;white-space:nowrap;font:500 12px var(--mono)">
  ${tick.map((m) => `<span><span style="color:var(--ink2)">${esc(m.short.toUpperCase())}</span> <span class="${m.yoy > 0 ? 'pos' : 'neg'}">${D.pct(m.yoy)}</span></span>`).join('')}
</div>
<section class="abs" style="left:28px;top:132px;width:600px">
  <div style="font:500 12px var(--mono);color:var(--acc)">&gt; NATIONAL · ${D.national.dataThrough} · 50 METROS</div>
  <h1 style="font:600 64px/0.98 var(--display);text-transform:uppercase;letter-spacing:-.005em;margin-top:18px">${esc(D.national.headline)}</h1>
</section>
<section class="abs" style="left:28px;top:560px;width:620px;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)">
  ${counters
    .map(
      (c, i) => `<div style="padding:16px 16px 18px ${i ? 16 : 0}px;${i ? 'border-left:1px solid var(--rule)' : ''}"><div style="font:500 11px var(--mono);color:var(--ink3);text-transform:uppercase">${c.label}</div><div class="num big" style="font-size:38px;margin-top:10px;font-weight:500">${c.value}</div><div class="num" style="font-size:13px;margin-top:4px"><span class="${c.sgn > 0 ? 'pos' : 'neg'}">${c.delta}</span> <span style="color:var(--ink3)">${c.dl}</span></div></div>`,
    )
    .join('')}
</section>
<div class="abs" style="left:28px;top:720px;display:flex;gap:10px"><span class="btn primary">ENTER THE MARKET ${ic(I.arrow, 15)}</span><span class="btn">READ THE BRIEF</span></div>
<div class="abs" style="left:0;right:0;bottom:0;height:30px;border-top:1px solid var(--rule);display:flex;align-items:center;gap:26px;padding:0 28px;font:500 11px var(--mono);color:var(--ink3)">
  <span style="color:var(--acc)">● LIVE SNAPSHOT</span><span>DATA ${D.national.dataThrough}</span><span>RATES ${D.national.ratesAsOf}</span><span>SRC REDFIN · ZILLOW · FRED · CENSUS</span><span class="spacer"></span><span>COLUMN H = MEDIAN PRICE · COLOR = YOY</span>
</div>`,
  );
}

// ---------- EXPLORE ----------
export function explore(T) {
  const map = tiltedMap({ cx: 664, cy: 478, scale: 1100, pitch: 46, bearing: -12, focal: 1300 });
  const [pMin, pMax] = D.priceExtent;
  const items = D.metros
    .map((m, i) => {
      const p = map.point(m.lon, m.lat);
      if (!p) return null;
      return { x: p[0], y: p[1], s: p[2], h: 16 + ((m.price - pMin) / (pMax - pMin)) * 170, color: divColor(T, m.yoy), id: `c${i}`, m };
    })
    .filter(Boolean);
  const ring = map.circle(D.area.center.lon, D.area.center.lat, D.area.radiusMi);
  const pc = map.point(D.area.center.lon, D.area.center.lat);
  const austin = items.find((c) => c.m.slug === D.dossierSlug);
  const aTop = [austin.x, austin.y - austin.h * austin.s];
  const ringCol = T.id === 'b' ? T.accent : T.accent;
  const statePaths = states.features.map((f) => map.path(f)).join('');
  const mapSvg = `<svg class="abs" style="inset:0" width="${W}" height="${H}" aria-hidden="true"><defs>${commonFilters}${T.colStyle === 'glow' ? columnGradients(items) : ''}
    <radialGradient id="bgMap" cx="55%" cy="40%" r="75%"><stop offset="0" stop-color="${T.bg2}"/><stop offset="1" stop-color="${T.bg}"/></radialGradient>
    <radialGradient id="ringFill"><stop offset="0" stop-color="${ringCol}" stop-opacity=".02"/><stop offset=".85" stop-color="${ringCol}" stop-opacity=".10"/><stop offset="1" stop-color="${ringCol}" stop-opacity=".22"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#bgMap)"/>
    ${T.id === 'a' ? `<path d="${map.path(nation)}" fill="none" stroke="#5CE1E6" stroke-opacity=".25" stroke-width="10" filter="url(#blur18)"/>` : ''}
    ${T.id === 'b' ? `<path d="${map.path(nation)}" transform="translate(10,14)" fill="#2a2620" opacity=".10" filter="url(#blur6)"/>` : ''}
    <path d="${statePaths}" fill="${T.land}" stroke="none"/>
    <path d="${map.path(stateMesh)}" fill="none" stroke="${T.landStroke}" stroke-width="${T.id === 'b' ? 0.8 : 0.9}" ${T.id === 'c' ? 'stroke-dasharray="1.5 3"' : ''}/>
    <path d="${map.path(nation)}" fill="none" stroke="${T.nationStroke}" stroke-width="${T.id === 'b' ? 1.4 : 1.1}"/>
    <path d="${ring}" fill="url(#ringFill)" stroke="${ringCol}" stroke-width="1.6" ${T.id === 'b' ? 'stroke-dasharray="6 5"' : ''}/>
    ${T.id === 'a' ? `<path d="${ring}" fill="none" stroke="${ringCol}" stroke-width="6" opacity=".35" filter="url(#blur6)"/>` : ''}
    <circle cx="${pc[0]}" cy="${pc[1]}" r="4" fill="${ringCol}"/><circle cx="${pc[0]}" cy="${pc[1]}" r="10" fill="none" stroke="${ringCol}" stroke-opacity=".6"/>
    ${columns(items, T.colStyle, { width: T.id === 'b' ? 10 : 9 })}
    <line x1="${aTop[0]}" y1="${aTop[1]}" x2="${aTop[0] + 60}" y2="${aTop[1] - 40}" stroke="${T.ink2}" stroke-width="1"/>
  </svg>`;

  // right context panel: area search
  const A = D.area;
  const tempOrder = ['Cold', 'Cool', 'Balanced', 'Warm', 'Hot'];
  const tempCols = { Cold: T.div.cool2, Cool: T.div.cool1, Balanced: T.div.mid, Warm: T.div.hot1, Hot: T.div.hot2 };
  const nIn = A.metros.length;
  const sliderPos = Math.log(A.radiusMi / 10) / Math.log(250 / 10);
  const ctx = `<aside class="panel" style="right:24px;top:84px;width:336px;padding:18px 18px 14px">
    <div style="display:flex;align-items:center;justify-content:space-between"><div class="label" style="color:var(--acc)">${ic(I.crosshair, 14)}&nbsp; Area search</div><span class="chip">Share</span></div>
    <div style="font:${T.id === 'a' ? '400 28px/1.05' : T.id === 'b' ? '500 24px/1.1' : '600 26px/1.02'} var(--display);margin-top:10px;${T.id === 'c' ? 'text-transform:uppercase' : ''}">${A.radiusMi} mi around<br>${esc(A.center.label)}</div>
    <div style="margin-top:16px;display:flex;align-items:center;gap:12px"><span class="num" style="font-size:12px;color:var(--ink3)">10</span>
      <div style="position:relative;flex:1;height:4px;border-radius:4px;background:var(--rule)"><div style="position:absolute;left:0;width:${(sliderPos * 100).toFixed(1)}%;top:0;bottom:0;border-radius:4px;background:var(--acc)"></div><div style="position:absolute;left:calc(${(sliderPos * 100).toFixed(1)}% - 9px);top:-7px;width:18px;height:18px;border-radius:${T.id === 'c' ? 0 : 50}%;background:${T.dark ? '#fff' : T.panel};border:2px solid var(--acc);box-shadow:0 0 0 6px ${T.dark ? 'rgba(92,225,230,.15)' : 'rgba(242,84,27,.12)'}"></div></div>
      <span class="num" style="font-size:12px;color:var(--ink3)">250 mi</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 12px;margin-top:20px;padding-top:16px;border-top:1px solid var(--rule)">
      <div><div class="label">Median price, weighted</div><div class="num big" style="font-size:30px;margin-top:4px">${D.usdCompact(A.price)}</div><div class="num" style="font-size:13px"><span class="${A.yoy > 0 ? 'pos' : 'neg'}">${D.pct(A.yoy)}</span> <span style="color:var(--ink3);font-family:var(--ui)">YoY</span></div></div>
      <div><div class="label">Active inventory</div><div class="num big" style="font-size:30px;margin-top:4px">${D.count(A.inventory)}</div><div style="font-size:13px;color:var(--ink3)">${nIn} metros inside</div></div>
    </div>
    <div style="margin-top:16px"><div class="label">Temperature mix</div>
      <div style="display:flex;height:10px;margin-top:8px;border-radius:${T.id === 'c' ? 0 : 5}px;overflow:hidden;gap:2px">${tempOrder.filter((k) => A.temps[k]).map((k) => `<div style="flex:${A.temps[k]};background:${tempCols[k]}"></div>`).join('')}</div>
      <div style="display:flex;gap:12px;margin-top:6px;font-size:12px;color:var(--ink2)">${tempOrder.filter((k) => A.temps[k]).map((k) => `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${tempCols[k]}"></span> ${k} ${A.temps[k]}</span>`).join('')}</div></div>
    <table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--ink3);font-size:11px;text-transform:uppercase;letter-spacing:.06em"><th style="text-align:left;font-weight:500;padding:6px 0">Metro</th><th style="text-align:right;font-weight:500">mi</th><th style="text-align:right;font-weight:500">Median</th><th style="text-align:right;font-weight:500">YoY</th></tr></thead>
      <tbody>${A.metros
        .map(
          (m) => `<tr style="border-top:1px solid var(--rule)"><td style="padding:7px 0">${esc(m.name)}</td><td class="num" style="text-align:right;color:var(--ink3)">${Math.round(m.dist)}</td><td class="num" style="text-align:right">${D.usdCompact(m.price)}</td><td class="num ${m.yoy > 0 ? 'pos' : 'neg'}" style="text-align:right">${D.pct(m.yoy)}</td></tr>`,
        )
        .join('')}</tbody></table>
    <div style="font-size:11px;color:var(--ink3);margin-top:10px">Weighted by homes sold (12 mo, ${D.count(A.sold12)} sales). Counties and ZIPs join once finer geography ships.</div>
  </aside>`;

  // left dock
  const metricsList = ['Median sale price', 'Active inventory', 'Median days on market', 'Listings with price drops', 'Months of supply', 'Sale-to-list ratio'];
  const layerOpts = ['Columns', 'Bubbles', 'Heat', 'Flat'];
  const dock = `<aside class="panel" style="left:24px;top:84px;width:228px;padding:14px">
    <div class="label" style="display:flex;align-items:center;gap:8px">${ic(I.layers, 14)} Layers</div>
    <div style="margin-top:12px;display:flex;flex-direction:column;gap:2px">${metricsList
      .map((n, i) => `<div style="padding:7px 10px;border-radius:var(--rc);font-size:${T.id === 'c' ? 12 : 14}px;white-space:nowrap;${i === 0 ? `background:${T.dark ? 'rgba(92,225,230,.12)' : 'rgba(242,84,27,.10)'};color:var(--ink);box-shadow:inset 2px 0 0 var(--acc)` : 'color:var(--ink2)'}">${n}</div>`)
      .join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);margin-top:14px;border:1px solid var(--pb);border-radius:var(--rc);overflow:hidden">${layerOpts
      .map((n, i) => `<div style="text-align:center;padding:6px 0;font-size:${T.id === 'c' ? 10.5 : 12}px;${i === 0 ? 'background:var(--acc);color:var(--acc-ink);font-weight:600' : 'color:var(--ink2)'}">${n}</div>`)
      .join('')}</div>
    <div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px;color:var(--ink2)"><span>Color by</span><span><b style="color:var(--ink);font-weight:600">YoY</b> · Value</span></div>
    <div style="margin-top:12px"><div style="height:8px;border-radius:${T.id === 'c' ? 0 : 4}px;background:linear-gradient(90deg,${T.div.cool2},${T.div.cool1},${T.div.mid},${T.div.hot1},${T.div.hot2})"></div>
      <div class="num" style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink3);margin-top:4px"><span>${D.pct(-D.yoyMaxAbs)}</span><span>0</span><span>${D.pct(D.yoyMaxAbs)}</span></div></div>
    <div style="font-size:12px;color:var(--ink3);margin-top:8px">Height: ${D.usdCompact(pMin)} → ${D.usdCompact(pMax)}</div>
    <div style="border-top:1px solid var(--rule);margin-top:14px;padding-top:12px;display:flex;flex-direction:column;gap:10px;font-size:13px">
      ${[
        [I.building, '3D buildings', true],
        [I.mountain, 'Terrain', false],
      ]
        .map(
          ([icon, n, on]) => `<div style="display:flex;align-items:center;gap:10px;color:var(--ink2)">${ic(icon, 15)}<span style="flex:1">${n}</span><span style="width:30px;height:18px;border-radius:${T.id === 'c' ? 0 : 9}px;background:${on ? 'var(--acc)' : 'var(--rule)'};position:relative"><i style="position:absolute;top:2px;${on ? 'right:2px' : 'left:2px'};width:14px;height:14px;border-radius:${T.id === 'c' ? 0 : 7}px;background:${on ? 'var(--acc-ink)' : 'var(--ink3)'}"></i></span></div>`,
        )
        .join('')}
    </div>
    <div style="border-top:1px solid var(--rule);margin-top:14px;padding-top:10px;font-size:12px;color:var(--ink3);display:flex;align-items:center;gap:8px"><span class="kbd">T</span> Table <span style="flex:1"></span><span class="kbd">?</span> Keys</div>
  </aside>`;

  // hover card for Austin
  const am = austin.m;
  const sp = linePath(am.spark, { x0: 0, y0: 0, w: 196, h: 40 });
  const hover = `<div class="panel" style="left:${aTop[0] + 64}px;top:${aTop[1] - 128}px;width:228px;padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-weight:600">${esc(am.name)}</b><span class="chip" style="height:20px;font-size:11px">${am.tempLabel} ${am.temp}</span></div>
    <div class="num" style="font-size:24px;margin-top:6px">${D.usd(am.price)} <span class="${am.yoy > 0 ? 'pos' : 'neg'}" style="font-size:13px">${D.pct(am.yoy)}</span></div>
    <svg width="196" height="44" style="margin-top:6px;overflow:visible" aria-hidden="true"><path d="${sp.d}" fill="none" stroke="${divColor(T, am.yoy)}" stroke-width="1.8"/><circle cx="${sp.pt(am.spark.length - 1)[0]}" cy="${sp.pt(am.spark.length - 1)[1]}" r="3" fill="${divColor(T, am.yoy)}"/></svg>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:${T.id === 'c' ? 11 : 12}px;margin-top:6px;color:var(--ink2);white-space:nowrap"><span>Days on mkt <b class="num" style="color:var(--ink);font-weight:500">${am.dom}</b></span><span>Supply <b class="num" style="color:var(--ink);font-weight:500">${am.mos} mo</b></span><span>Inventory <b class="num" style="color:var(--ink);font-weight:500">${D.count(am.inventory)}</b></span><span>24-mo trend</span></div>
  </div>`;

  // time machine
  const dates = D.national.series.dates;
  const x0 = 320;
  const x1 = 980;
  const xAt = (i) => x0 + (i / (dates.length - 1)) * (x1 - x0);
  const idxOf = (iso) => dates.findIndex((d) => d >= iso.slice(0, 7));
  const monthIdx = (iso) => {
    const i = dates.findIndex((d) => d.slice(0, 7) === iso.slice(0, 7));
    return i >= 0 ? i : idxOf(iso);
  };
  const ticks = dates
    .map((d, i) => `<line x1="${xAt(i)}" y1="${d.slice(5, 7) === '01' ? 30 : 36}" x2="${xAt(i)}" y2="44" stroke="${T.ink3}" stroke-opacity="${d.slice(5, 7) === '01' ? 0.9 : 0.45}"/>${d.slice(5, 7) === '01' ? `<text x="${xAt(i) + 4}" y="58" fill="${T.ink3}" font-size="11" font-family="${T.mono.replace(/'/g, '')}">${d.slice(0, 4)}</text>` : ''}`)
    .join('');
  const ev = D.rateEvents
    .map((e) => {
      const i = monthIdx(e.date);
      const end = i > dates.length / 2;
      return `<g><circle cx="${xAt(i)}" cy="14" r="4" fill="none" stroke="${e.kind === 'high' ? T.div.hot2 : T.div.cool2}" stroke-width="1.5"/><line x1="${xAt(i)}" y1="18" x2="${xAt(i)}" y2="44" stroke="${T.ink3}" stroke-opacity=".5" stroke-dasharray="2 2"/><text text-anchor="${end ? 'end' : 'start'}" x="${xAt(i) + (end ? -8 : 8)}" y="18" fill="${T.ink2}" font-size="12" font-family="${T.ui.replace(/'/g, '')}">${e.label} · ${D.monthLabel(e.date)}</text></g>`;
    })
    .join('');
  const last = dates.length - 1;
  const scrub = `<div class="panel" style="left:276px;right:384px;bottom:24px;height:96px;padding:10px 18px;display:flex;gap:18px;align-items:center">
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center;flex:none"><div style="width:44px;height:44px;border-radius:${T.id === 'c' ? 0 : 50}%;background:var(--acc);color:var(--acc-ink);display:grid;place-items:center">${ic(I.play, 18)}</div><span class="num" style="font-size:11px;color:var(--ink3);white-space:nowrap"><b style="color:var(--ink);font-weight:600">1×</b> 4×</span></div>
    <svg width="${x1 - x0 + 20}" height="70" viewBox="${x0 - 10} 0 ${x1 - x0 + 20} 70" aria-hidden="true">
      <line x1="${x0}" y1="44" x2="${x1}" y2="44" stroke="${T.ink3}" stroke-opacity=".5"/>
      <line x1="${x0}" y1="44" x2="${xAt(last)}" y2="44" stroke="${T.accent}" stroke-width="2"/>
      ${ticks}${ev}
      <rect x="${xAt(last) - 7}" y="34" width="14" height="20" rx="${T.id === 'c' ? 0 : 4}" fill="${T.accent}"/>
    </svg>
  </div>`;

  const bigDate = `<div class="abs" style="left:280px;bottom:134px;font:${T.id === 'a' ? 'italic 400 64px/1' : T.id === 'b' ? '500 56px/1' : '600 60px/1'} var(--display);${T.id === 'c' ? 'text-transform:uppercase;' : ''}color:var(--ink);opacity:.92;letter-spacing:-.02em">${D.monthLabel(dates[last], 'long')}</div>`;
  return page(
    T,
    'Explore',
    `${mapSvg}${T.id === 'a' ? grain(0.12) : ''}${topbar(T, 'Atlas')}${dock}${ctx}${hover}${bigDate}${scrub}
    <div class="attrib" style="left:24px;bottom:8px">© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors · Terrain: AWS Terrain Tiles · Data: Redfin</div>`,
  );
}

// ---------- DOSSIER ----------
const REG = Object.fromEntries(D.index.metric_registry.map((r) => [r.key, r]));
const SHORT = { median_sale_price: 'Median sale price', homes_sold: 'Homes sold', inventory: 'Inventory', months_of_supply: 'Supply', median_dom: 'Days on mkt', avg_sale_to_list: 'Sale-to-list', price_drops: 'Price drops' };
function fmtValue(key, v) {
  const r = REG[key];
  if (v == null) return '—';
  if (r.format === 'currency') return D.usd(v);
  if (r.format === 'count') return D.count(v);
  if (r.format === 'percent') return `${(v * 100).toFixed(1)}%`;
  if (r.format === 'days') return `${v} d`;
  if (r.format === 'decimal1') return `${v.toFixed(1)} mo`;
  return String(v);
}
function fmtChange(key, c) {
  const r = REG[key];
  if (c == null) return '—';
  if (r.change_kind === 'ratio') return D.pct(c);
  if (r.change_kind === 'pp') return D.pp(c * 100, 2);
  if (r.format === 'days') return D.signed(Math.round(c), ' d');
  return D.signed(+c.toFixed(1), ' mo');
}

function thermalArc(T, score, r = 56) {
  const a0 = Math.PI;
  const pt = (t) => [r + 8 + r * Math.cos(a0 + t * Math.PI), r + 8 + r * Math.sin(a0 + t * Math.PI)];
  const [sx, sy] = pt(0);
  const [ex, ey] = pt(1);
  const [mx, my] = pt(score / 100);
  return `<svg width="${2 * r + 16}" height="${r + 18}" aria-hidden="true"><defs><linearGradient id="therm" x1="0" x2="1"><stop offset="0" stop-color="${T.div.cool2}"/><stop offset=".5" stop-color="${T.div.mid}"/><stop offset="1" stop-color="${T.div.hot2}"/></linearGradient></defs>
  <path d="M${sx},${sy} A${r},${r} 0 0 1 ${ex},${ey}" fill="none" stroke="url(#therm)" stroke-width="6" stroke-linecap="${T.id === 'c' ? 'butt' : 'round'}" opacity=".9"/>
  <circle cx="${mx}" cy="${my}" r="7" fill="${T.bg}" stroke="${T.ink}" stroke-width="2"/></svg>`;
}

function plate(T) {
  const r = rng(21);
  if (T.id === 'a') {
    // abstract night grid: receding street grid with scattered lights
    let s = '';
    const vx = 980;
    const vy = 150;
    for (let i = -30; i <= 30; i++) s += `<line x1="${vx}" y1="${vy}" x2="${vx + i * 90}" y2="${H}" stroke="#7FB2FF" stroke-opacity=".07"/>`;
    for (let k = 1; k < 16; k++) {
      const y = vy + (H - vy) * (k / 16) ** 1.9;
      s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#7FB2FF" stroke-opacity="${(0.02 + 0.06 * (k / 16)).toFixed(3)}"/>`;
    }
    for (let i = 0; i < 700; i++) {
      const t = r() ** 1.6;
      const y = vy + (H - vy) * t;
      const x = vx + (r() - 0.5) * (200 + 2600 * t);
      const warm = r() < 0.55;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.3 + t * 1.8).toFixed(2)}" fill="${warm ? '#FFB86B' : '#9FD0FF'}" opacity="${(0.15 + r() * 0.6).toFixed(2)}"/>`;
    }
    return s;
  }
  if (T.id === 'b') {
    // architectural study model: a field of small clay blocks
    let s = '';
    const blocks = [];
    for (let gx = -2; gx < 22; gx++)
      for (let gy = -2; gy < 14; gy++) {
        if (r() < 0.35) continue;
        blocks.push({ gx, gy, h: 6 + r() ** 2 * 40 });
      }
    blocks.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
    for (const b of blocks) {
      const X = 480 + (b.gx - b.gy) * 30;
      const Y = 40 + (b.gx + b.gy) * 17;
      const w = 22;
      s += `<path d="M${X},${Y} l${w},${w * 0.5} v${-b.h} l${-w},${-w * 0.5}z" fill="#E4E0D7" stroke="#2a2620" stroke-opacity=".18" stroke-width=".6"/>
<path d="M${X},${Y} l${-w},${w * 0.5} v${-b.h} l${w},${-w * 0.5}z" transform="translate(${w},${w * 0.5}) scale(-1,1) translate(${-w},${-w * 0.5})" fill="#F7F5F0" stroke="#2a2620" stroke-opacity=".18" stroke-width=".6"/>
<path d="M${X},${Y - b.h} l${w},${w * 0.5} l${w},${-w * 0.5} l${-w},${-w * 0.5}z" fill="#FDFCF9" stroke="#2a2620" stroke-opacity=".2" stroke-width=".6"/>`;
    }
    return s;
  }
  // C: a sparse dot-matrix skyline silhouette
  let s = '';
  let x = 0;
  while (x < W) {
    const bw = 18 + r() * 50;
    const bh = 40 + r() ** 1.5 * 260;
    for (let yy = H - 330; yy > H - 330 - bh; yy -= 8) for (let xx = x; xx < x + bw; xx += 8) if (r() < 0.55) s += `<rect x="${xx}" y="${yy}" width="2" height="2" fill="${r() < 0.08 ? '#FFB000' : '#3A3A3A'}"/>`;
    x += bw + 6;
  }
  return s;
}

function housePalette(T, temp, ghost = false) {
  const light = temp < 50 ? T.cold : T.hot;
  if (T.id === 'a')
    return { plotTop: '#0F1629', plotSide: '#0A0F1D', path: '#1A233B', wallL: '#18203A', wallR: '#111831', gable: '#141C34', roofL: '#232E4F', chimney: '#1A2340', chimneySide: '#131A30', window: mix('#FFC98A', light, 0.35), windowGlow: '#FFB86B', door: '#0B101F', line: light, lineOpacity: 0.55, light, ghost };
  if (T.id === 'b')
    return { plotTop: '#E8E4DA', plotSide: '#D6D1C6', plotSide2: '#CCC6BA', path: '#DDD8CD', wallL: '#FBFAF7', wallR: '#E6E2DA', gable: '#E1DDD4', roofL: '#F2EFE9', chimney: '#EDEAE3', chimneySide: '#DAD5CB', window: '#57534B', windowGlow: '#57534B', door: '#57534B', line: '#2a2620', lineOpacity: 0.45, light };
  return { plotTop: '#000', plotSide: '#000', path: '#000', wallL: '#000', wallR: '#000', gable: '#000', roofL: '#000', chimney: '#000', chimneySide: '#000', window: '#000', windowGlow: '#000', door: '#000', line: light, lineOpacity: 0.95, light };
}

function houseScene(T, { cx, cy, scale, temp, ghostScale, ghostDx = 0 }) {
  const p = housePalette(T, temp);
  const hs = house({ x: 0, y: 0, size: scale, p, windowsLit: T.id !== 'b' });
  const off = [-(hs.width * 0.5 - 1.3 * 26 * scale) * 0 - 30 * scale, 0];
  const ghost = ghostScale ? house({ x: 0, y: 0, size: ghostScale, p, ghost: true }).svg : '';
  const glow =
    T.id === 'a'
      ? `<ellipse cx="0" cy="${70 * scale}" rx="${230 * scale}" ry="${120 * scale}" fill="${p.light}" opacity=".22" filter="url(#blur40)"/>
         <ellipse cx="${60 * scale}" cy="${-40 * scale}" rx="${150 * scale}" ry="${110 * scale}" fill="${p.light}" opacity=".16" filter="url(#blur40)"/>`
      : T.id === 'b'
        ? `<ellipse cx="${110 * scale}" cy="${150 * scale}" rx="${190 * scale}" ry="${46 * scale}" fill="#2a2620" opacity=".16" filter="url(#blur18)"/>`
        : '';
  return `<g transform="translate(${cx + off[0]},${cy})">${glow}${ghost ? `<g transform="translate(${ghostDx},${-10})">${ghost}</g>` : ''}${hs.svg}</g>`;
}

export function dossier(T) {
  const m = D.dossier;
  const L = m.latest;
  const temp = m.temp;
  const heroH = 552;
  const tc = tempColor(T, temp);
  const hero = `<svg class="abs" style="left:0;top:0" width="${W}" height="${heroH}" aria-hidden="true"><defs>${commonFilters}
    <linearGradient id="heroFade" x1="0" x2="1"><stop offset="0" stop-color="${T.bg}" stop-opacity="1"/><stop offset=".42" stop-color="${T.bg}" stop-opacity=".82"/><stop offset=".7" stop-color="${T.bg}" stop-opacity="0"/></linearGradient>
    <linearGradient id="heroFadeB" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="${T.bg}" stop-opacity="0"/><stop offset="1" stop-color="${T.bg}" stop-opacity="1"/></linearGradient></defs>
    <rect width="${W}" height="${heroH}" fill="${T.id === 'a' ? '#070B16' : T.bg}"/>
    <g opacity="${T.id === 'b' ? 0.9 : 1}">${plate(T)}</g>
    <rect width="${W}" height="${heroH}" fill="url(#heroFade)"/><rect width="${W}" height="${heroH}" fill="url(#heroFadeB)"/>
    ${houseScene(T, { cx: 1010, cy: 250, scale: 1.25, temp })}
  </svg>`;
  const head = [
    ['median_sale_price', 'Median sale price'],
    ['median_dom', 'Days on market'],
    ['inventory', 'Active inventory'],
  ];
  const instruments = ['median_sale_price', 'homes_sold', 'inventory', 'months_of_supply', 'median_dom', 'avg_sale_to_list', 'price_drops'];
  const trend = (t) => (t === 'up' ? I.trendUp : t === 'down' ? I.trendDown : I.flat);
  const cluster = instruments
    .map((k, i) => {
      const v = L[k];
      const series = m.series[k];
      const lp = linePath(series, { x0: 0, y0: 2, w: 118, h: 30 });
      const hiI = series.indexOf(Math.max(...series.filter((x) => x != null)));
      const loI = series.indexOf(Math.min(...series.filter((x) => x != null)));
      const wide = i === 0;
      const w = wide ? 212 : 130;
      const lp2 = linePath(series, { x0: 0, y0: 2, w: w - 28, h: 26 });
      void lp;
      return `<div style="width:${w}px;flex:none;padding:12px 14px 10px;${i ? 'border-left:1px solid var(--rule);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="label" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${SHORT[k] ?? REG[k].label}</span><span style="color:var(--ink3)">${ic(trend(v.trend_3m), 14)}</span></div>
        <div class="num big" style="font-size:${wide ? 30 : 21}px;margin-top:4px;white-space:nowrap">${fmtValue(k, v.value)}</div>
        <div class="num" style="font-size:12px;white-space:nowrap"><span class="${v.yoy > 0 ? 'pos' : v.yoy < 0 ? 'neg' : ''}">${fmtChange(k, v.yoy)}</span> <span style="color:var(--ink3)">YoY</span></div>
        <svg width="${w - 28}" height="30" style="margin-top:6px;display:block;overflow:visible" aria-hidden="true"><path d="${lp2.d}" fill="none" stroke="${T.ink2}" stroke-width="1.3"/>
        <circle cx="${lp2.pt(hiI)[0]}" cy="${lp2.pt(hiI)[1]}" r="2.2" fill="${T.div.hot2}"/><circle cx="${lp2.pt(loI)[0]}" cy="${lp2.pt(loI)[1]}" r="2.2" fill="${T.div.cool2}"/><circle cx="${lp2.pt(series.length - 1)[0]}" cy="${lp2.pt(series.length - 1)[1]}" r="2.8" fill="${T.accent}"/></svg>
      </div>`;
    })
    .join('');
  // main chart: 36 months of median sale price, annotated, with a synced 30-yr rate strip
  const cw = 992 - 40;
  const px = m.series.median_sale_price;
  const dts = m.series.dates;
  const mc = linePath(px, { x0: 0, y0: 22, w: cw, h: 70 });
  const vals = px.filter((v) => v != null);
  const hi = px.indexOf(Math.max(...vals));
  const lo = px.indexOf(Math.min(...vals));
  const lastI = px.length - 1;
  const monthlyRate = dts.map((d) => {
    const on = D.rateSeries.filter((r) => r.d <= d);
    return on.length ? on[on.length - 1].v : null;
  });
  const rc = linePath(monthlyRate, { x0: 0, y0: 2, w: cw, h: 22 });
  const xhair = hi;
  const ann = (i, text, anchor = 'middle', dy = -10) => `<text x="${mc.pt(i)[0]}" y="${mc.pt(i)[1] + dy}" text-anchor="${anchor}" font-size="11" fill="${T.ink2}" font-family="${T.mono.replace(/'/g, '')}">${text}</text><circle cx="${mc.pt(i)[0]}" cy="${mc.pt(i)[1]}" r="3.2" fill="${T.bg}" stroke="${T.ink}" stroke-width="1.5"/>`;
  const chart = `<div class="panel" style="position:relative;width:992px;height:196px;margin-top:12px;padding:12px 20px">
    <div style="display:flex;align-items:center;gap:10px"><span class="label" style="color:var(--ink2)">Median sale price · 36 months</span><span style="flex:1"></span>
      ${['1Y', '3Y', 'All'].map((r) => `<span class="chip" style="height:22px;${r === '3Y' ? 'color:var(--ink);border-color:var(--acc)' : ''}">${r}</span>`).join('')}<span class="chip" style="height:22px">Index to U.S.</span></div>
    <svg width="${cw}" height="146" style="display:block;margin-top:2px;overflow:visible" aria-hidden="true">
      <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${T.accent}" stop-opacity="${T.id === 'b' ? 0.18 : 0.22}"/><stop offset="1" stop-color="${T.accent}" stop-opacity="0"/></linearGradient></defs>
      <path d="${mc.d}L${cw},104L0,104Z" fill="url(#area)"/>
      <path d="${mc.d}" fill="none" stroke="${T.accent}" stroke-width="2"/>
      <line x1="${mc.pt(xhair)[0]}" y1="0" x2="${mc.pt(xhair)[0]}" y2="140" stroke="${T.ink3}" stroke-dasharray="3 3"/>
      ${ann(hi, `36-mo high ${D.usdCompact(px[hi])} · ${D.monthLabel(dts[hi])}`, 'start', -10)}
      ${ann(lo, `low ${D.usdCompact(px[lo])}`, 'middle', 18)}
      ${ann(lastI, `${D.usdCompact(px[lastI])}`, 'end', -10)}
      <line x1="0" y1="112" x2="${cw}" y2="112" stroke="${T.rule}"/>
      <g transform="translate(0,114)"><path d="${rc.d}" fill="none" stroke="${T.ink2}" stroke-width="1.3"/><circle cx="${rc.pt(xhair)[0]}" cy="${rc.pt(xhair)[1]}" r="2.6" fill="${T.ink}"/>
        <text x="${cw}" y="10" text-anchor="end" font-size="11" fill="${T.ink3}" font-family="${T.ui.replace(/'/g, '')}">30-yr rate, month-end · ${D.monthLabel(dts[lastI])} ${monthlyRate[lastI].toFixed(2)}%</text>
        <text x="${rc.pt(xhair)[0] + 8}" y="24" font-size="11" fill="${T.ink2}" font-family="${T.mono.replace(/'/g, '')}">${monthlyRate[xhair].toFixed(2)}%</text></g>
    </svg></div>`;
  // what drives the temperature: signed components around zero
  const comps = Object.entries(m.components);
  const cmax = Math.max(...comps.map(([, v]) => Math.abs(v)));
  const plain = { avg_sale_to_list: 'Sale-to-list', sold_above_list: 'Sold above list', off_market_in_two_weeks: 'Off market in 2 wks', median_dom: 'Days on market', price_drops: 'Price drops', months_of_supply: 'Months of supply' };
  const drivers = `<div style="margin-top:14px"><div class="label" style="display:flex;justify-content:space-between"><span>What drives the temperature</span><span style="text-transform:none;letter-spacing:0">cools ← → heats</span></div>
    ${comps
      .map(
        ([k, v]) => `<div style="display:grid;grid-template-columns:128px 1fr 48px;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:var(--ink2)"><span>${plain[k] ?? k}</span>
      <span style="position:relative;height:8px"><i style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--ink3)"></i><i style="position:absolute;top:0;bottom:0;${v < 0 ? `right:50%;width:${((-v / cmax) * 50).toFixed(1)}%;background:${T.div.cool2}` : `left:50%;width:${((v / cmax) * 50).toFixed(1)}%;background:${T.div.hot2}`};border-radius:${T.id === 'c' ? 0 : 2}px"></i></span>
      <span class="num" style="text-align:right">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}</span></div>`,
      )
      .join('')}</div>`;
  const nameFont = { a: '400 116px/0.9', b: '500 104px/0.9', c: '600 112px/0.88' }[T.id];
  const brief = m.brief;
  const chips = ['median_sale_price', 'inventory', 'median_dom', 'months_of_supply'].map((k) => `<span class="chip" style="border-color:${k === 'median_sale_price' ? 'var(--acc)' : 'var(--pb)'};color:${k === 'median_sale_price' ? 'var(--ink)' : 'var(--ink2)'}">${REG[k].label}</span>`).join('');
  return page(
    T,
    'Dossier',
    `${hero}${topbar(T, 'Atlas')}
    <div class="abs" style="right:28px;top:84px;font-size:11px;color:var(--ink3);border:1px solid var(--pb);padding:2px 8px;border-radius:var(--rchip)">Illustrative</div>
    <section class="abs" style="left:64px;top:88px;width:720px">
      <div style="font-size:13px;color:var(--ink3)">Atlas <span style="opacity:.5">/</span> Texas <span style="opacity:.5">/</span> <span style="color:var(--ink2)">${esc(m.name)}</span></div>
      <h1 style="font:${nameFont} var(--display);letter-spacing:-.03em;margin-top:12px;${T.id === 'c' ? 'text-transform:uppercase' : ''}">${esc(m.short)}<span style="font-size:.32em;letter-spacing:0;color:var(--ink3);margin-left:14px;font-family:var(--ui);font-weight:500">TX</span></h1>
      <div style="display:flex;gap:10px;margin-top:18px"><span class="chip" style="border-color:${tc};color:var(--ink)"><i style="width:8px;height:8px;border-radius:50%;background:${tc}"></i>${m.tempLabel} market</span><span class="chip">${esc(m.marketType)}</span>${m.flags.map((f) => `<span class="chip">${ic(I.flag, 12)} ${esc(f.label)}</span>`).join('')}</div>
      <div style="display:flex;align-items:flex-end;gap:40px;margin-top:26px">
        <div style="display:flex;align-items:flex-end;gap:14px"><div>${thermalArc(T, temp)}<div class="label" style="text-align:center;margin-top:-4px">Temperature</div></div><div class="num big" style="font-size:64px;line-height:.9;color:${tc}">${temp}<span style="font-size:18px;color:var(--ink3)">/100</span></div></div>
        ${head
          .map(([k, lab]) => `<div><div class="label">${lab}</div><div class="num" style="font-size:28px;margin-top:4px">${fmtValue(k, L[k].value)}</div><div class="num ${L[k].yoy > 0 ? 'pos' : 'neg'}" style="font-size:13px">${fmtChange(k, L[k].yoy)} <span style="color:var(--ink3)">YoY</span></div></div>`)
          .join('')}
      </div>
      <div style="display:flex;gap:10px;margin-top:22px"><span class="btn primary">${ic(I.plane, 15)} Fly there</span><span class="btn">Affordability studio ${ic(I.arrow, 15)}</span><span class="btn">${ic(I.compare, 15)} Compare with…</span></div>
    </section>
    <section class="abs" style="left:24px;top:${heroH - 64}px;width:992px">
      <div class="panel" style="position:relative;display:flex;width:992px">${cluster}</div>
      ${chart}
    </section>
    <section class="abs" style="left:1044px;top:${heroH - 64}px;width:372px">
      <div class="label" style="color:var(--acc)">The story</div>
      <p style="font:${T.id === 'a' ? 'italic 400 22px/1.28 var(--display)' : T.id === 'b' ? '500 18px/1.35 var(--display)' : '500 14px/1.5 var(--mono)'};margin-top:8px">${esc(brief.key_points[0])}. ${esc(brief.key_points[1])}.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${chips}</div>
      ${drivers}
    </section>
    <div class="attrib" style="left:24px;bottom:10px">Data: Redfin, a national real estate brokerage · Zillow Research · FRED</div>`,
  );
}

// ---------- AFFORDABILITY ----------
export function affordability(T) {
  const A = D.afford;
  const m = D.dossier;
  const unit = 130 / Math.max(A.down, A.principal, A.interest);
  const pal = T.id === 'a' ? { line: '#9FB6E6', lineOpacity: 0.35 } : T.id === 'b' ? { line: '#2a2620', lineOpacity: 0.45 } : { line: '#FFB000', lineOpacity: 0.9 };
  const blockCols =
    T.id === 'a'
      ? [
          { front: '#1C2742', side: '#141C31', top: '#2A3960', label: 'Down payment', value: A.down },
          { front: '#1E4F66', side: '#153A4C', top: '#5CE1E6', label: 'Principal', value: A.principal },
          { front: '#5A3A22', side: '#432A18', top: '#FFB86B', label: 'Interest, 30 yrs', value: A.interest },
        ]
      : T.id === 'b'
        ? [
            { front: '#FBFAF7', side: '#E4E0D7', top: '#FFFFFF', label: 'Down payment', value: A.down },
            { front: '#F2EFE9', side: '#DAD5CB', top: '#FBFAF7', label: 'Principal', value: A.principal },
            { front: '#F6C3A8', side: '#E8A07A', top: '#F2541B', label: 'Interest, 30 yrs', value: A.interest },
          ]
        : [
            { front: '#000', side: '#000', top: '#000', label: 'Down payment', value: A.down },
            { front: '#000', side: '#000', top: '#000', label: 'Principal', value: A.principal },
            { front: '#1a1200', side: '#0d0900', top: '#FFB000', label: 'Interest, 30 yrs', value: A.interest },
          ];
  const stack = isoStack({ x: 1130, y: 760, items: blockCols, unit, w: 84, d: 84, p: pal });
  const total = A.down + A.principal + A.interest;
  const stackLabels = stack.tops
    .map((t) => {
      const [, y] = t.anchor;
      return `<div class="abs" style="left:${1130 + 84 * 0.866 + 22}px;top:${y - 20}px;white-space:nowrap;border-left:1px solid var(--rule);padding-left:10px"><div class="label" style="font-size:11px">${t.label}</div><div class="num" style="font-size:18px">${D.usd(t.value)}</div></div>`;
    })
    .join('');
  const sliders = [
    { label: 'Price', value: D.usd(A.price), sub: `published median · ${D.pct(A.price / D.national.price - 1)} vs U.S.`, pos: 0.42 },
    { label: 'Down payment', value: `${(A.downPct * 100).toFixed(0)}%`, sub: D.usd(A.down), pos: A.downPct / 0.5 },
    { label: '30-yr rate', value: `${A.rate.toFixed(2)}%`, sub: `latest Freddie Mac PMMS · year ago ${A.rateAgo.toFixed(2)}%`, pos: (A.rate - 3) / 6 },
  ];
  const sliderHtml = sliders
    .map(
      (s) => `<div style="margin-top:22px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="label">${s.label}</span><span class="num" style="font-size:24px">${s.value}</span></div>
      <div style="position:relative;height:28px;margin-top:6px"><div style="position:absolute;left:0;right:0;top:12px;height:4px;border-radius:4px;background:var(--rule)"></div><div style="position:absolute;left:0;width:${(s.pos * 100).toFixed(1)}%;top:12px;height:4px;border-radius:4px;background:var(--acc)"></div>
      <div style="position:absolute;left:calc(${(s.pos * 100).toFixed(1)}% - 13px);top:1px;width:26px;height:26px;border-radius:${T.id === 'c' ? 0 : 50}%;background:${T.dark ? '#fff' : '#fff'};border:2px solid var(--acc);box-shadow:0 2px 10px rgba(0,0,0,.25)"></div></div>
      <div style="font-size:12px;color:var(--ink3)">${s.sub}</div></div>`,
    )
    .join('');
  const scene = `<svg class="abs" style="inset:0" width="${W}" height="${H}" aria-hidden="true"><defs>${commonFilters}
    <radialGradient id="stageGlow" cx="50%" cy="58%" r="55%"><stop offset="0" stop-color="${T.id === 'a' ? '#101B38' : T.bg2}"/><stop offset="1" stop-color="${T.bg}"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#stageGlow)"/>
    ${T.id === 'a' ? starfield(160, 5) : ''}
    ${T.id === 'b' ? `<g stroke="#2a2620" stroke-opacity=".07">${Array.from({ length: 40 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}"/><line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}"/>`).join('')}</g>` : ''}
    ${T.id === 'c' ? `<g fill="#2a2a2a">${Array.from({ length: 36 * 23 }, (_, i) => `<rect x="${(i % 36) * 40 + 20}" y="${Math.floor(i / 36) * 40 + 20}" width="1.5" height="1.5"/>`).join('')}</g>` : ''}
    ${houseScene(T, { cx: 700, cy: 360, scale: 1.3 * A.houseScale, temp: m.temp, ghostScale: 1.3 * A.ghostScale, ghostDx: -30 })}
    ${stack.svg}
  </svg>`;
  const pti = `<div style="display:flex;align-items:center;gap:14px;margin-top:22px;padding-top:18px;border-top:1px solid var(--rule)">
    <svg width="64" height="64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="${T.ink3}" stroke-opacity=".6" stroke-width="5" stroke-dasharray="3 5"/></svg>
    <div><div class="label">Payment-to-income</div><div style="font-size:13px;color:var(--ink2);margin-top:2px;max-width:220px">Needs income data: Census ACS income isn't in this run, so the ring stays empty rather than guess.</div></div></div>`;
  return page(
    T,
    'Affordability',
    `${scene}${topbar(T, 'Atlas')}
    <section class="abs" style="left:64px;top:104px;width:420px">
      <div style="font-size:13px;color:var(--ink3)">${esc(m.name)} <span style="opacity:.5">/</span> <span style="color:var(--ink2)">Affordability studio</span></div>
      <h1 style="font:${T.id === 'a' ? '400 52px/1' : T.id === 'b' ? '500 46px/1' : '600 50px/.95'} var(--display);margin-top:14px;letter-spacing:-.02em;${T.id === 'c' ? 'text-transform:uppercase' : ''}">What a median home costs here</h1>
      ${sliderHtml}
      <div style="margin-top:22px"><div class="label">Term</div><div style="display:inline-grid;grid-template-columns:repeat(3,64px);margin-top:8px;border:1px solid var(--pb);border-radius:var(--rc);overflow:hidden">${[15, 20, 30].map((t) => `<span style="text-align:center;padding:7px 0;font-size:13px;${t === A.term ? 'background:var(--acc);color:var(--acc-ink);font-weight:600' : 'color:var(--ink2)'}">${t} yr</span>`).join('')}</div></div>
      <div style="display:flex;gap:10px;margin-top:26px"><span class="btn">${ic(I.reset, 15)} Reset to published</span></div>
    </section>
    <div class="abs" style="left:560px;top:700px;font-size:12px;color:var(--ink3);width:320px">House scale ${A.houseScale.toFixed(2)}× the U.S. median (${D.usdCompact(D.national.price)}). Dashed: a year ago, ${D.usd(A.priceAgo)} at ${A.rateAgo.toFixed(2)}%.</div>
    <aside class="panel" style="right:40px;top:92px;width:360px;padding:20px 22px 18px">
      <div class="label">Monthly payment, principal + interest</div>
      <div class="num big" style="font-size:56px;line-height:1.05;margin-top:8px;color:var(--ink)">${D.usdCents(A.payment)}</div>
      <div style="display:flex;gap:18px;margin-top:10px;font-size:13px;color:var(--ink2)"><span>Year ago <b class="num" style="color:var(--ink);font-weight:500">${D.usdCents(A.paymentAgo)}</b></span><span class="num ${A.paymentChange > 0 ? 'pos' : 'neg'}">${D.pct(A.paymentChange)}</span></div>
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--rule);display:flex;justify-content:space-between"><span class="label">Total over ${A.term} yrs</span><span class="num" style="font-size:18px">${D.usd(total)}</span></div>
      ${pti}
    </aside>
    ${stackLabels}
    <div class="attrib" style="left:64px;bottom:14px">Rates: Freddie Mac PMMS via FRED · Prices: Redfin · Taxes, insurance and HOA not included</div>`,
  );
}
