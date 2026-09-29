// Phase 6 stills: the affordability studio (Austin) published and with custom inputs,
// Night and Dawn at 1440, plus a phone. GPU for the 3D house.
import { launch } from '../browser.mjs';

const BASE = process.env.STUDIO_BASE ?? 'http://localhost:4173/real-estate-agent/#/metro/austin-tx/afford';
const OUT = '../docs/screenshots/v2';
const b = await launch({ gpu: true });
const shots = [
  ['p6-studio-published-night', 'dark', 1440, 900, ''],
  ['p6-studio-custom-night', 'dark', 1440, 900, '?price=650000&rate=5.50&term=15'],
  ['p6-studio-published-dawn', 'light', 1440, 900, ''],
  ['p6-studio-mobile-night', 'dark', 390, 844, ''],
];
for (const [name, theme, w, h, q] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(BASE + q);
  await p.waitForSelector('[data-house-mode]');
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: w < 500 });
  await p.close();
  console.log('shot', name);
}
await b.close();
