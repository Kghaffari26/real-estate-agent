// Phase 8 stills: the weekly pulse ticker, county area search and the dossier's weekly/county panels (Night, 1440).
import { launch } from './browser.mjs';
const ROOT = 'http://localhost:4173/real-estate-agent/#';
const OUT = 'C:/Users/thekk/real-estate-agent/docs/screenshots/v2/';
const b = await launch({ gpu: true });
const shots = [
  ['p8-arrival-ticker', '/', 1440, 900, async (p) => { await p.evaluate(() => document.querySelector('[data-testid=pulse-ticker]')?.scrollIntoView({ block: 'center' })); }],
  ['p8-explore-area', '/explore?pin=39.9500,-75.1600&r=40&t=all', 1440, 900, null],
  ['p8-dossier-weekly', '/metro/philadelphia-pa', 1440, 900, async (p) => { await p.evaluate(() => document.getElementById('weekly')?.scrollIntoView({ block: 'start' })); }],
];
for (const [name, path, w, h, act] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => localStorage.setItem('re-theme', 'dark'));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(ROOT + path);
  await p.waitForTimeout(5000);
  if (act) { await act(p); await p.waitForTimeout(1500); }
  await p.screenshot({ path: OUT + name + '.png' });
  console.log(name, errs.slice(0, 3));
  await p.close();
}
await b.close();
