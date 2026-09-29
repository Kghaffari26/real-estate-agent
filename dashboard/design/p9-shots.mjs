// Phase 9 stills (gate D): the quality tiers and the moments menu. Night unless noted.
import { launch } from './browser.mjs';

const ROOT = process.env.P9_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const OUT = process.env.OUT ?? '../../docs/screenshots/v2/'; // run from dashboard/design
const b = await launch({ gpu: true });
const shots = [
  ['p9-arrival-low-dawn', '/?tier=low', 1440, 900, 'light'],
  ['p9-explore-medium', '/explore?tier=medium&cam=-75.5,40.2,6.4,55,-20', 1440, 900, 'dark'],
  ['p9-explore-low', '/explore?tier=low', 1440, 900, 'dark'],
  ['p9-dossier-low', '/metro/denver-co?tier=low', 1440, 900, 'dark'],
  ['p9-compare-low-dawn', '/compare?m=oakland-ca,denver-co,austin-tx&tier=low', 1440, 900, 'light'],
  ['p9-explore-mobile', '/explore?tier=medium', 390, 844, 'dark'],
];
for (const [name, path, w, h, theme] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(ROOT + path);
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `${OUT}${name}.png` });
  await p.close();
  console.log('shot', name);
}
await b.close();
