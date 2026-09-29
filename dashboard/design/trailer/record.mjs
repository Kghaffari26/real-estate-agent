// The v2 trailer (~40 s WebM) and the README hero GIF, recorded from the local preview
// on this machine's GPU. No ffmpeg: the trailer is Playwright's own video (VP8 WebM);
// the GIF is frame captures encoded with gifenc (pure JS).
//
//   npx vite preview --port 4173 &   then   node design/trailer/record.mjs [trailer|gif]
//
// Writes docs/media/trailer.webm and docs/media/hero.gif (run from dashboard/).
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';
import { launch, mapLoaded, projector } from '../browser.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const ROOT = process.env.TRAILER_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const OUT = resolve('../docs/media');
mkdirSync(OUT, { recursive: true });
const which = process.argv[2] ?? 'all';

async function newPage(b, size, video, scale = 1) {
  const ctx = await b.newContext({ viewport: size, deviceScaleFactor: scale, ...(video ? { recordVideo: { dir: video, size } } : {}) });
  await ctx.addInitScript(() => localStorage.setItem('re-theme', 'dark'));
  return { ctx, page: await ctx.newPage() };
}

const project = (page, lon, lat) => projector(page)(lon, lat);
const go = (page, hash) => page.evaluate((h) => (window.location.hash = h), hash);
const wait = (page, ms) => page.waitForTimeout(ms);
const ease = (page, view, duration) =>
  page.evaluate(
    ([v, d]) =>
      new Promise((done) => {
        const map = Array.from(document.querySelectorAll('div')).find((x) => x.__map)?.__map;
        if (!map) return done();
        map.once('moveend', done);
        map.easeTo({ ...v, duration: d });
      }),
    [view, duration],
  );

async function tour(page) {
  // 1. Arrival: the globe turns and the headline counts up.
  await page.goto(`${ROOT}/`);
  await page.waitForSelector('canvas', { timeout: 20_000 }).catch(() => {});
  await wait(page, 3600);
  // 2. The dive into the atlas.
  await page.getByRole('button', { name: /Enter the market/ }).first().click();
  await mapLoaded(page).catch(() => {});
  await wait(page, 1900);
  // 3. Pull, tilt and turn over the Northeast.
  await ease(page, { center: [-75.4, 40.3], zoom: 6.2, pitch: 58, bearing: -24 }, 3200);
  await wait(page, 400);
  // 4. Area search: a ring around Philadelphia, then widen it.
  await wait(page, 700);
  const at = await project(page, -75.35, 39.85); // just off Philadelphia's column: empty map
  await page.mouse.click(at.x, at.y);
  await wait(page, 1400);
  const radius = page.getByRole('slider', { name: 'Radius' });
  await radius.focus().catch(() => {});
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('ArrowRight');
    await wait(page, 90);
  }
  await wait(page, 1200);
  // 5. The time machine from 2012, at 4×.
  await go(page, '/explore?t=0');
  await ease(page, { center: [-96.5, 38.6], zoom: 3.7, pitch: 45, bearing: 0 }, 1500);
  await page.getByRole('radio', { name: '4×' }).check({ force: true }).catch(() => {});
  await page.getByRole('button', { name: 'Play the time machine' }).click().catch(() => {});
  await wait(page, 5200);
  // 6. A dossier: the house in its market's light.
  await go(page, '/metro/austin-tx');
  await wait(page, 2800);
  // 7. The studio: move the rate, watch the house and the payment.
  await go(page, '/metro/austin-tx/afford');
  await wait(page, 1800);
  const rate = page.getByRole('slider', { name: '30-yr rate' });
  await rate.focus().catch(() => {});
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('ArrowLeft');
    await wait(page, 60);
  }
  await wait(page, 1500);
  // 8. The compare arena.
  await go(page, '/compare?m=oakland-ca,denver-co,austin-tx&metrics=median_sale_price');
  await wait(page, 3200);
}

async function recordTrailer(b) {
  const dir = resolve('../docs/media/.video');
  rmSync(dir, { recursive: true, force: true });
  const { ctx, page } = await newPage(b, { width: 1280, height: 720 }, dir);
  const t0 = Date.now();
  await tour(page);
  await ctx.close();
  const [file] = readdirSync(dir);
  renameSync(join(dir, file), join(OUT, 'trailer.webm'));
  rmSync(dir, { recursive: true, force: true });
  console.log(`trailer.webm: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function recordGif(b) {
  // The hero: the globe turning, then the dive into the atlas (~8 s at ~8 fps).
  // The desktop layout (1280×720) captured at 0.625×: an 800×450 GIF.
  const { ctx, page } = await newPage(b, { width: 1280, height: 720 }, null, 0.625);
  await page.goto(`${ROOT}/`);
  await page.waitForSelector('canvas', { timeout: 20_000 }).catch(() => {});
  await wait(page, 2500);
  const frames = [];
  const grab = async (n, gap) => {
    for (let i = 0; i < n; i++) {
      const t = Date.now();
      frames.push(await page.screenshot({ type: 'png' }));
      await wait(page, Math.max(0, gap - (Date.now() - t)));
    }
  };
  await grab(24, 120);
  await page.getByRole('button', { name: /Enter the market/ }).first().click();
  await grab(20, 120);
  await mapLoaded(page).catch(() => {});
  await page.evaluate(() => {
    const map = Array.from(document.querySelectorAll('div')).find((x) => x.__map)?.__map;
    map?.easeTo({ center: [-80, 38.5], zoom: 4.6, pitch: 55, bearing: -18, duration: 2600 });
  });
  await grab(22, 120);
  await ctx.close();
  const gif = GIFEncoder();
  for (const buf of frames) {
    const { data, width, height } = PNG.sync.read(buf);
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: 120 });
  }
  gif.finish();
  writeFileSync(join(OUT, 'hero.gif'), gif.bytes());
  console.log(`hero.gif: ${frames.length} frames, ${(gif.bytes().length / 1024 / 1024).toFixed(1)} MB`);
}

const b = await launch({ gpu: true });
if (which === 'all' || which === 'trailer') await recordTrailer(b);
if (which === 'all' || which === 'gif') await recordGif(b);
await b.close();
