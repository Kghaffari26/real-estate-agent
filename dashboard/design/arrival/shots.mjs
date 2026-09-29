// Phase 4 stills: /arrival hero at 1440, 1280 and 390 px in Night and Dawn (GPU globe).
import { launch } from '../browser.mjs';

const URL = process.env.ARRIVAL_URL ?? 'http://localhost:4173/real-estate-agent/#/arrival';
const b = await launch({ gpu: true });
for (const [theme, name] of [['dark', 'night'], ['light', 'dawn']]) {
  for (const [label, w, h] of [['desktop', 1440, 900], ['laptop', 1280, 800], ['mobile', 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await p.goto(URL);
    await p.waitForSelector('[data-testid="globe-canvas"]');
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `../docs/screenshots/v2/p4-arrival-${label}-${name}.png` });
    await p.close();
    console.log('shot', label, name);
  }
}
await b.close();
