// Every figure shown in the Gate A frames is computed here from the committed
// sample snapshot. Nothing is typed in by hand.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, '..', '..', 'sample-data');
const read = (p) => JSON.parse(readFileSync(join(sample, p), 'utf8'));

export const index = read('latest.json');
export const metro = (slug) => read(`metros/${slug}.json`);

// ---------- formatting (same conventions as src/lib/format.ts) ----------
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const usd = (v) => `$${nf0.format(Math.round(v))}`;
export const usdCents = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usdCompact = (v) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(1)}K`;
export const countCompact = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : nf0.format(v));
export const count = (v) => nf0.format(Math.round(v));
const minus = '−';
export const pct = (r, d = 1) => `${r > 0 ? '+' : r < 0 ? minus : ''}${Math.abs(r * 100).toFixed(d)}%`;
export const pp = (v, d = 2) => `${v > 0 ? '+' : v < 0 ? minus : ''}${Math.abs(v).toFixed(d)} pp`;
export const signed = (v, unit = '') => `${v > 0 ? '+' : v < 0 ? minus : ''}${Math.abs(v)}${unit}`;
export const monthLabel = (iso, style = 'short') =>
  new Date(`${iso}T12:00:00Z`).toLocaleString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });

// ---------- national ----------
const nat = index.national;
const ks = Object.fromEntries(index.key_stats.map((k) => [k.label, k]));
export const national = {
  headline: index.headline,
  price: ks['US median sale price'].value,
  priceYoy: ks['US median sale price'].delta,
  rate: ks['30-yr mortgage'].value,
  rate1w: ks['30-yr mortgage'].delta,
  inventory: nat.latest.inventory.value,
  inventoryYoy: nat.latest.inventory.yoy,
  dom: nat.latest.median_dom.value,
  temperature: nat.temperature,
  dataThrough: index.data_through,
  ratesAsOf: index.rates_as_of,
  briefPoints: nat.brief.key_points,
  series: nat.series,
};
export const freshness = `Redfin through ${monthLabel(index.data_through)} · Rates ${new Date(`${index.rates_as_of}T12:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;

// ---------- metros ----------
export const metros = index.metros.map((m) => ({
  slug: m.slug,
  name: m.name,
  short: m.name.replace(/, [A-Z]{2}(-[A-Z]{2})*$/, ''),
  lat: m.lat,
  lon: m.lon,
  sold12: m.homes_sold_12m,
  price: m.latest.median_sale_price.value,
  yoy: m.latest.median_sale_price.yoy,
  inventory: m.latest.inventory.value,
  inventoryYoy: m.latest.inventory.yoy,
  dom: m.latest.median_dom.value,
  mos: m.latest.months_of_supply.value,
  temp: m.temperature.score,
  tempLabel: m.temperature.label,
  marketType: m.market_type,
  spark: m.spark,
}));
export const bySlug = Object.fromEntries(metros.map((m) => [m.slug, m]));
export const priceExtent = [Math.min(...metros.map((m) => m.price)), Math.max(...metros.map((m) => m.price))];
export const yoyMaxAbs = Math.max(...metros.map((m) => Math.abs(m.yoy)));

// ---------- area search (the pure function Phase 3 moves to src/lib/area.ts) ----------
const R_MI = 3958.8;
export function milesBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}
export function areaSearch(center, radiusMi) {
  const inside = metros
    .map((m) => ({ ...m, dist: milesBetween(center, m) }))
    .filter((m) => m.dist <= radiusMi)
    .sort((a, b) => a.dist - b.dist);
  const w = inside.reduce((s, m) => s + m.sold12, 0);
  const wavg = (k) => inside.reduce((s, m) => s + m[k] * m.sold12, 0) / w;
  const temps = { Cold: 0, Cool: 0, Balanced: 0, Warm: 0, Hot: 0 };
  inside.forEach((m) => (temps[m.tempLabel] += 1));
  return {
    center,
    radiusMi,
    metros: inside,
    price: wavg('price'),
    yoy: wavg('yoy'),
    inventory: inside.reduce((s, m) => s + m.inventory, 0),
    sold12: w,
    temps,
  };
}
const philly = bySlug['philadelphia-pa'];
export const area = areaSearch({ lat: philly.lat, lon: philly.lon, label: 'Philadelphia, PA' }, 100);

// ---------- rates events (max/min of the 30-yr within the 36-month window) ----------
const rates = nat.rates;
const windowStart = nat.series.dates[0];
const rs = rates.dates.map((d, i) => ({ d, v: rates.mortgage30[i] })).filter((r) => r.d >= windowStart && r.v != null);
const hi = rs.reduce((a, b) => (b.v > a.v ? b : a));
const lo = rs.reduce((a, b) => (b.v < a.v ? b : a));
export const rateEvents = [
  { kind: 'high', date: hi.d, value: hi.v, label: `30-yr high ${hi.v.toFixed(2)}%` },
  { kind: 'low', date: lo.d, value: lo.v, label: `30-yr low ${lo.v.toFixed(2)}%` },
];
export const rateSeries = rs;

// ---------- the dossier metro ----------
export const dossierSlug = 'austin-tx';
const am = metro(dossierSlug);
export const dossier = {
  ...bySlug[dossierSlug],
  file: am,
  brief: am.brief,
  flags: am.flags,
  components: am.temperature.components,
  latest: am.latest,
  series: am.series,
  affordability: am.affordability,
};

// ---------- affordability (same formula as src/lib/amortization.ts) ----------
export function monthlyPayment(price, downPct, ratePct, years) {
  const loan = price * (1 - downPct);
  const r = ratePct / 100 / 12;
  const n = years * 12;
  return r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
}
const aff = am.affordability;
const a = aff.assumptions;
const payNow = monthlyPayment(dossier.price, a.down_payment_pct, a.rate_now, a.term_years);
const payAgo = monthlyPayment(a.price_year_ago, a.down_payment_pct, a.rate_year_ago, a.term_years);
if (Math.abs(payNow - aff.payment_now) > 0.01 || Math.abs(payAgo - aff.payment_year_ago) > 0.01) {
  throw new Error(`calculator mismatch: ${payNow} vs ${aff.payment_now}, ${payAgo} vs ${aff.payment_year_ago}`);
}
const loan = dossier.price * (1 - a.down_payment_pct);
const clamp = (v, lo2, hi2) => Math.min(hi2, Math.max(lo2, v));
export const afford = {
  price: dossier.price,
  downPct: a.down_payment_pct,
  rate: a.rate_now,
  term: a.term_years,
  payment: aff.payment_now,
  paymentAgo: aff.payment_year_ago,
  paymentChange: aff.payment_change_pct,
  priceAgo: a.price_year_ago,
  rateAgo: a.rate_year_ago,
  down: dossier.price * a.down_payment_pct,
  principal: loan,
  interest: payNow * a.term_years * 12 - loan,
  pti: aff.payment_to_income,
  houseScale: clamp(dossier.price / national.price, 0.6, 1.6),
  ghostScale: clamp(a.price_year_ago / national.price, 0.6, 1.6),
};

// Three metros for the "hot / balanced / cold" temperature-light swatches.
export const trio = ['oakland-ca', 'denver-co', 'austin-tx'].map((s) => bySlug[s]);
export const investigation = index.investigations[0];
export const movers = index.movers;
