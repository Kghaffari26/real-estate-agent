// R0 stills (v3 spec): the restyled basemap over Orange County and Los Angeles at
// metro, city and street zoom, in Night and Dawn, with real OpenFreeMap tiles.
import { launch, mapLoaded } from './browser.mjs';

const ROOT = process.env.R0_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const OUT = process.env.OUT ?? '../../docs/screenshots/v3/'; // run from dashboard/design
const views = [
  ['national', '-96.2,37.4,3.35,45,-12'],
  ['socal', '-118.0,33.9,8.4,45,-12'],
  ['oc', '-117.79,33.66,9.7,50,-18'],
  ['irvine', '-117.80,33.68,12.4,55,-20'],
  ['street', '-117.87,33.61,14.6,55,-20'],
];
const b = await launch({ gpu: true });
for (const theme of ['dark', 'light']) {
  for (const [name, cam] of views) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(`${ROOT}/explore?cam=${cam}`);
    await mapLoaded(p);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${OUT}r0-${name}-${theme === 'dark' ? 'night' : 'dawn'}.png` });
    await p.close();
    console.log('shot', name, theme);
  }
}
await b.close();
