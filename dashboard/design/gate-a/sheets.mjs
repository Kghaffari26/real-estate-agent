// One 2x2 contact sheet per direction from the rendered frames (review aid for Gate A).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { themes } from './themes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = resolve(here, '..', '..', '..', 'docs', 'screenshots', 'v2', 'gate-a');
const pw = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const c = existsSync(pw) ? readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().pop() : null;
const executablePath = c ? [join(pw, c, 'chrome-win64', 'chrome.exe'), join(pw, c, 'chrome-win', 'chrome.exe')].find(existsSync) : undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1480, height: 1010 } });
const names = ['1-arrival', '2-explore', '3-dossier', '4-affordability'];
for (const t of Object.values(themes)) {
  const html = `<!doctype html><body style="margin:0;background:#111;font:600 15px system-ui;color:#eee">
  <div style="padding:10px 14px">${t.id.toUpperCase()} · ${t.name} <span style="font-weight:400;color:#aaa">— ${t.tagline}</span></div>
  <div style="display:grid;grid-template-columns:720px 720px;gap:12px;padding:0 14px">${names
    .map((n) => `<img src="${pathToFileURL(join(shots, `${t.id}-${n}.png`)).href}" width="720" height="450" style="display:block">`)
    .join('')}</div></body>`;
  const f = join(here, 'out', `sheet-${t.id}.html`);
  writeFileSync(f, html);
  await page.goto(pathToFileURL(f).href, { waitUntil: 'load' });
  await page.screenshot({ path: join(shots, `sheet-${t.id}.png`), fullPage: true });
}
await browser.close();
