/**
 * Frame-timing smoke (spec §9): records requestAnimationFrame intervals while the atlas
 * pans and tilts, and while the time machine plays. Warning only: CI runners render
 * WebGL in software, so the numbers are recorded (test annotations and the log) and
 * compared with the targets, never failed on.
 */
import type { Page } from '@playwright/test';
import { expect, gotoView, test } from './fixtures';

const TARGET_FPS = 60;

async function measure(page: Page, during: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as Window & { __frames?: number[]; __stop?: boolean };
    w.__frames = [];
    w.__stop = false;
    const tick = (t: number) => {
      w.__frames!.push(t);
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await during();
  const frames = await page.evaluate(() => {
    const w = window as Window & { __frames?: number[]; __stop?: boolean };
    w.__stop = true;
    return w.__frames ?? [];
  });
  const gaps = frames.slice(1).map((t, i) => t - frames[i]!).sort((a, b) => a - b);
  const span = (frames[frames.length - 1]! - frames[0]!) / 1000;
  return { fps: Math.round((frames.length - 1) / span), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), frames: frames.length };
}

test('frame timing while panning the atlas and playing the time machine (warning only)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop pass only');
  test.setTimeout(90_000);
  await gotoView(page, '/explore');
  await expect(page.locator('[data-atlas-mode="3d"]')).toBeAttached({ timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('div')).some((d) => (d as HTMLElement & { __map?: { loaded: () => boolean } }).__map?.loaded()), undefined, { timeout: 30_000 });

  const pan = await measure(page, async () => {
    await page.evaluate(async () => {
      const el = Array.from(document.querySelectorAll('div')).find((d) => (d as HTMLElement & { __map?: unknown }).__map) as unknown as HTMLElement & { __map: { easeTo: (o: object) => void; once: (e: string, f: () => void) => void } };
      const map = el.__map;
      for (const step of [{ center: [-87.6, 41.9], zoom: 6, pitch: 55, bearing: -20 }, { center: [-97.7, 30.3], zoom: 5, pitch: 40, bearing: 15 }, { center: [-98.5, 39], zoom: 3.6, pitch: 45, bearing: 0 }]) {
        await new Promise<void>((done) => {
          map.once('moveend', () => done());
          map.easeTo({ ...step, duration: 1500 });
        });
      }
    });
  });
  const play = await measure(page, async () => {
    await page.getByRole('button', { name: 'Play the time machine' }).click();
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Pause the time machine' }).click();
  });

  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  for (const [name, r] of [['pan/tilt', pan], ['time machine', play]] as const) {
    const note = `${name}: ${r.fps} fps (p95 frame ${r.p95} ms, ${r.frames} frames) on ${renderer}; target ${TARGET_FPS}`;
    info.annotations.push({ type: r.fps >= TARGET_FPS * 0.9 ? 'fps' : 'warning', description: note });
    console.log(`[fps] ${note}`);
  }
  expect(pan.frames).toBeGreaterThan(10); // it rendered at all
});
