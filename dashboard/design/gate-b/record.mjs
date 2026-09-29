// Gate B screen recording (docs/screenshots/v2/gate-b-explore.webm): the pull (pan,
// rotate, tilt), hover, area search with the camera flight and a growing radius, the
// time machine (scrub + 4x playback), a lasso and the table view. Uses the GPU.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { launch, BASE, mapLoaded, projector } from '../browser.mjs';

const TMP = '../docs/screenshots/v2/_rec';
const OUT = '../docs/screenshots/v2/gate-b-explore.webm';
mkdirSync(TMP, { recursive: true });
const b = await launch({ gpu: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: TMP, size: { width: 1440, height: 900 } } });
const p = await ctx.newPage();
await p.addInitScript(() => localStorage.setItem('re-theme', 'dark'));
await p.goto(BASE);
await mapLoaded(p);
await p.waitForTimeout(2500);
const proj = projector(p);
const drag = async (x0, y0, x1, y1, o = {}) => {
  await p.mouse.move(x0, y0);
  await p.mouse.down(o);
  await p.mouse.move(x1, y1, { steps: o.steps ?? 40 });
  await p.mouse.up(o);
};
// 1. the pull
await drag(640, 600, 580, 560, { steps: 30 });
await p.waitForTimeout(400);
await drag(700, 620, 830, 580, { button: 'right', steps: 55 });
await p.waitForTimeout(700);
await drag(830, 580, 680, 640, { button: 'right', steps: 55 });
await p.waitForTimeout(800);
// 2. hover
for (const [lon, lat] of [[-118.24, 34.05], [-97.74, 30.27], [-80.19, 25.76]]) {
  const q = await proj(lon, lat);
  await p.mouse.move(q.x, q.y - 6, { steps: 22 });
  await p.waitForTimeout(1100);
}
// 3. area search on open ground in Kansas (no metro within 75 mi), then widen to 250 mi
const k = await proj(-97.3, 38.4);
await p.mouse.move(k.x, k.y, { steps: 22 });
await p.mouse.click(k.x, k.y);
await p.waitForTimeout(3300);
const s = await p.getByRole('slider', { name: 'Radius' }).boundingBox();
await drag(s.x + s.width * 0.73, s.y + s.height / 2, s.x + s.width * 0.99, s.y + s.height / 2, { steps: 60 });
await p.waitForTimeout(2600);
// 4. time machine
const m = await p.getByRole('slider', { name: 'Month' }).boundingBox();
await drag(m.x + m.width - 6, m.y + m.height / 2, m.x + m.width * 0.38, m.y + m.height / 2, { steps: 70 });
await p.waitForTimeout(1500);
await p.getByText('4×', { exact: true }).click();
await p.getByRole('button', { name: 'Play the time machine' }).click();
await p.waitForTimeout(5000);
await p.getByRole('button', { name: 'Pause the time machine' }).click();
await p.waitForTimeout(500);
// 5. lasso the Northeast from the national view
await p.goto(`${BASE}?cam=-96.2,37.4,3.35,45,-12&t=2026-08`);
await p.reload();
await mapLoaded(p);
await p.waitForTimeout(2000);
const ring = [];
for (const [lo, la] of [[-81.5, 43.2], [-69.5, 44.5], [-71.5, 38.3], [-79.0, 37.2]]) ring.push(await proj(lo, la));
await p.keyboard.down('Shift');
await p.mouse.move(ring[0].x, ring[0].y);
await p.mouse.down();
for (const q of [...ring.slice(1), ring[0]]) await p.mouse.move(q.x, q.y, { steps: 20 });
await p.mouse.up();
await p.keyboard.up('Shift');
await p.waitForTimeout(2400);
// 6. table view
await p.locator('body').press('t');
await p.waitForTimeout(2400);
await p.locator('body').press('t');
await p.waitForTimeout(900);
await ctx.close();
await b.close();
renameSync(`${TMP}/${readdirSync(TMP).find((n) => n.endsWith('.webm'))}`, OUT);
rmSync(TMP, { recursive: true, force: true });
console.log('video bytes', statSync(OUT).size);
