// Frame timing on this machine's GPU (the e2e fps smoke runs on software GL): pan/tilt
// the atlas and play the time machine, then print fps and p95 frame times.
import { launch, mapLoaded } from './browser.mjs';

const ROOT = process.env.FPS_BASE ?? 'http://localhost:4173/real-estate-agent/#';
const b = await launch({ gpu: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`${ROOT}/explore`);
await mapLoaded(p);
await p.waitForTimeout(1500);
async function measure(during) {
  await p.evaluate(() => {
    window.__f = [];
    window.__s = false;
    const t = (x) => (window.__f.push(x), window.__s || requestAnimationFrame(t));
    requestAnimationFrame(t);
  });
  await during();
  const f = await p.evaluate(() => ((window.__s = true), window.__f));
  const g = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  return `${Math.round((f.length - 1) / ((f.at(-1) - f[0]) / 1000))} fps, p95 ${Math.round(g[Math.floor(g.length * 0.95)])} ms`;
}
const pan = await measure(() =>
  p.evaluate(async () => {
    const map = Array.from(document.querySelectorAll('div')).find((d) => d.__map).__map;
    for (const s of [{ center: [-87.6, 41.9], zoom: 6, pitch: 55, bearing: -20 }, { center: [-97.7, 30.3], zoom: 5, pitch: 40, bearing: 15 }, { center: [-98.5, 39], zoom: 3.6, pitch: 45, bearing: 0 }])
      await new Promise((d) => (map.once('moveend', d), map.easeTo({ ...s, duration: 1500 })));
  }),
);
const play = await measure(async () => {
  await p.getByRole('button', { name: 'Play the time machine' }).click();
  await p.waitForTimeout(3000);
});
const gpu = await p.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
});
console.log(`GPU: ${gpu}\npan/tilt: ${pan}\ntime machine: ${play}`);
await b.close();
