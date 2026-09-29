// Gate B stills: /explore at 1440, 1280 and 390 px in Night and Dawn, on the live
// OpenFreeMap basemap. Needs `npm run build && npx vite preview --port 4173`.
import { launch, BASE, mapLoaded } from '../browser.mjs';

const OUT = '../docs/screenshots/v2';
const SHOTS = [
  ['desktop', 1440, 900, '?pin=39.9526,-75.1652&r=100&cam=-78.5,39.2,5.2,55,-18'],
  ['laptop', 1280, 800, '?sel=austin-tx'],
  ['mobile', 390, 844, ''],
];
const b = await launch();
for (const theme of ['dark', 'light']) {
  for (const [name, w, h, q] of SHOTS) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(BASE + q);
    await mapLoaded(p);
    await p.waitForTimeout(3500); // tiles and fonts settle
    await p.screenshot({ path: `${OUT}/p3-explore-${name}-${theme === 'dark' ? 'night' : 'dawn'}.png` });
    await p.close();
    console.log('shot', name, theme);
  }
}
await b.close();
