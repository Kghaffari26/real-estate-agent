// R2 stills (gate E): the Orange County regional view at county, city and ZIP level,
// Night and Dawn at 1440, plus a phone; real OpenFreeMap tiles, this machine's GPU.
import { launch, mapLoaded } from './browser.mjs';

const ROOT = process.env.R2_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const OUT = process.env.OUT ?? '../../docs/screenshots/v3/'; // run from dashboard/design
const OC = '/explore?region=orange-county';
const shots = [
  ['r2-county-night', 'dark', 1440, 900, `${OC}&cam=-117.80,33.69,9.9,40,-12`],
  ['r2-county-dawn', 'light', 1440, 900, `${OC}&cam=-117.80,33.69,9.9,40,-12`],
  ['r2-county-yoy-night', 'dark', 1440, 900, `${OC}&by=yoy&cam=-117.80,33.69,9.9,40,-12`],
  ['r2-city-night', 'dark', 1440, 900, `${OC}&city=0636770&cam=-117.78,33.67,11.3,45,-12`],
  ['r2-zip-dawn', 'light', 1440, 900, `${OC}&zip=92660&cam=-117.87,33.62,12.3,45,-12`],
  ['r2-table-night', 'dark', 1440, 900, `${OC}&view=table&cam=-117.80,33.69,9.9,40,-12`],
  ['r2-phone-night', 'dark', 390, 844, `${OC}&cam=-117.80,33.66,9.2,30,0`],
];
const b = await launch({ gpu: true });
for (const [name, theme, w, h, path] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(ROOT + path.replace('&by=yoy', '&by=yoy').replace(/^\/explore\?region=orange-county(?!.*&by=)/, (m) => `${m}&by=value`));
  await mapLoaded(p);
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}${name}.png` });
  await p.close();
  console.log('shot', name);
}
await b.close();
