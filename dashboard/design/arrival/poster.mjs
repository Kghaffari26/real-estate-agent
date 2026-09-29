// Arrival globe posters (spec §9: poster first, globe after). Renders the live globe
// with rotation off and the copy hidden, then crops a square around it:
// public/media/arrival-globe-{night,dawn}.jpg (target ≤ 80 KB each).
// Needs `npm run build && npx vite preview --port 4173`.
import { statSync } from 'node:fs';
import { launch } from '../browser.mjs';

const URL = process.env.ARRIVAL_URL ?? 'http://localhost:4173/real-estate-agent/#/arrival';
const b = await launch({ gpu: true });
for (const [theme, name] of [['dark', 'night'], ['light', 'dawn']]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(URL);
  await p.waitForSelector('[data-testid="globe-canvas"]');
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: 'header, h1, section[aria-label="Overview"] > div:not([aria-hidden]), .mp-grain, .mp-atmosphere, img { visibility: hidden !important; } section[aria-label="Overview"] > .pointer-events-none { display: none !important; }' });
  await p.waitForTimeout(400);
  const clip = await p.evaluate(() => {
    const c = document.querySelector('[data-testid="globe-canvas"]').getBoundingClientRect();
    const r = Math.min(window.innerHeight * 0.4, 520);
    return { x: Math.round(c.left + c.width / 2 - r), y: Math.round(c.top + c.height / 2 - r), width: Math.round(2 * r), height: Math.round(2 * r) };
  });
  const out = `public/media/arrival-globe-${name}.jpg`;
  await p.screenshot({ path: out, type: 'jpeg', quality: 62, clip });
  console.log(out, clip.width, 'px', Math.round(statSync(out).size / 1024), 'KB');
  await p.close();
}
await b.close();
