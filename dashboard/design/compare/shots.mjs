// Phase 7 stills: the compare arena (Oakland, Denver, Austin) in Night and Dawn at
// 1440, full page and a phone, plus the empty state and the methodology page. GPU for 3D.
import { launch } from '../browser.mjs';

const ROOT = process.env.COMPARE_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const OUT = process.env.OUT ?? '../../docs/screenshots/v2'; // run from dashboard/design
const TRIO = '/compare?m=oakland-ca,denver-co,austin-tx&metrics=median_sale_price,inventory';
const b = await launch({ gpu: true });
const shots = process.env.ONLY ? process.env.ONLY.split(',') : null;
const all = [
  ['p7-compare-night', 'dark', 1440, 900, TRIO, false],
  ['p7-compare-full-night', 'dark', 1440, 900, TRIO, true],
  ['p7-compare-dawn', 'light', 1440, 900, TRIO + '&range=All&indexed=1', true],
  ['p7-compare-mobile-night', 'dark', 390, 844, TRIO, true],
  ['p7-compare-empty-night', 'dark', 1440, 900, '/compare', false],
  ['p7-methodology-night', 'dark', 1440, 900, '/methodology', true],
  ['p7-methodology-dawn', 'light', 1440, 900, '/methodology', false],
];
for (const [name, theme, w, h, path, full] of all.filter((s) => !shots || shots.includes(s[0]))) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(ROOT + path);
  await p.waitForSelector('main');
  await p.waitForTimeout(4500);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  await p.close();
  console.log('shot', name);
}
await b.close();
