// Gate C: hot / balanced / cold dossiers side by side (Oakland 95, Denver 41, Austin 11),
// in Night and Dawn at 1440, plus phones and a combined sheet. GPU for the 3D house.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { launch } from '../browser.mjs';

const OUT = resolve('../docs/screenshots/v2/gate-c');
const BASE = process.env.DOSSIER_BASE ?? 'http://localhost:4173/real-estate-agent/#/dossier/';
const TRIO = [['oakland-ca', 'Hot · 95'], ['denver-co', 'Balanced · 41'], ['austin-tx', 'Cold · 11']];
const b = await launch({ gpu: true });
for (const [theme, name] of [['dark', 'night'], ['light', 'dawn']]) {
  for (const [slug] of TRIO) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(BASE + slug);
    await p.waitForSelector('[data-house-mode]');
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${OUT}/${slug}-${name}.png` });
    if (theme === 'dark') {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${OUT}/${slug}-mobile-${name}.png` });
    }
    await p.close();
    console.log('shot', slug, name);
  }
}
// Side-by-side sheet (HTML composited in the browser: no image libraries needed).
const page = await b.newPage({ viewport: { width: 2220, height: 1200 } });
const img = (f) => pathToFileURL(`${OUT}/${f}`).href;
const html = `<!doctype html><body style="margin:0;background:#0b0d12;font:600 18px system-ui;color:#eef2fa">
<div style="display:grid;grid-template-columns:repeat(3,720px);gap:18px;padding:18px">
${['night', 'dawn'].map((n) => TRIO.map(([s, label]) => `<figure style="margin:0"><img src="${img(`${s}-${n}.png`)}" width="720" height="450" style="display:block;border-radius:8px"><figcaption style="padding:8px 2px">${label} · ${n === 'night' ? 'Night' : 'Dawn'}</figcaption></figure>`).join('')).join('')}
</div></body>`;
writeFileSync(`${OUT}/_sheet.html`, html);
await page.goto(pathToFileURL(`${OUT}/_sheet.html`).href, { waitUntil: 'load' });
await page.screenshot({ path: `${OUT}/sheet.png`, fullPage: true });
await b.close();
