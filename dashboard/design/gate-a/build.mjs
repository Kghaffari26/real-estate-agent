// Gate A: write 3 directions x 4 frames as HTML, then screenshot them at 1440x900.
//   node design/gate-a/build.mjs            (HTML + PNG)
//   node design/gate-a/build.mjs --html     (HTML only)
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { themes } from './themes.mjs';
import { arrival, explore, dossier, affordability } from './frames.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outHtml = join(here, 'out');
const outPng = resolve(here, '..', '..', '..', 'docs', 'screenshots', 'v2', 'gate-a');
mkdirSync(outHtml, { recursive: true });
mkdirSync(outPng, { recursive: true });

const frames = { '1-arrival': arrival, '2-explore': explore, '3-dossier': dossier, '4-affordability': affordability };
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const files = [];
for (const t of Object.values(themes)) {
  for (const [name, fn] of Object.entries(frames)) {
    const id = `${t.id}-${name}`;
    if (only && !id.startsWith(only)) continue;
    const f = join(outHtml, `${id}.html`);
    writeFileSync(f, fn(t));
    files.push({ id, f });
  }
}
console.log(`wrote ${files.length} frames`);
if (process.argv.includes('--html')) process.exit(0);

// Use the pinned Playwright browser when present, else the newest local Chromium.
const { chromium } = await import('playwright-core');
let executablePath;
const pwDir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
if (pwDir && existsSync(pwDir)) {
  const c = readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = c && join(pwDir, c, 'chrome-win', 'chrome.exe');
  const exe64 = c && join(pwDir, c, 'chrome-win64', 'chrome.exe');
  executablePath = [exe, exe64].find((p) => p && existsSync(p));
}
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const { id, f } of files) {
  await page.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outPng, `${id}.png`) });
  console.log('shot', id);
}
await browser.close();
