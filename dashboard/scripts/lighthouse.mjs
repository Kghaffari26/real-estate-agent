#!/usr/bin/env node
// Usage: node scripts/lighthouse.mjs [--base http://localhost:4173/real-estate-agent/] [--strict] [--applied]
//
// Lighthouse on Arrival and Explore (spec §9), mobile and desktop presets, against a
// running `vite preview`. Accessibility must be 100 (fails the run). Performance is
// compared with the spec's targets (≥ 85 mobile, ≥ 95 desktop) and reported as a
// warning, because shared CI runners have no GPU and noisy CPU; `--strict` makes it fail
// too. Uses CHROME_PATH (or PW_CHROMIUM) when set, else chrome-launcher's search.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:4173/real-estate-agent/';
const strict = args.includes('--strict');
const ROUTES = [
  { name: 'arrival', hash: '#/' },
  { name: 'explore', hash: '#/explore' },
];
const TARGETS = { mobile: 85, desktop: 95 };
const out = resolve('lighthouse-report');
mkdirSync(out, { recursive: true });

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH ?? process.env.PW_CHROMIUM,
  chromeFlags: ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = false;
const rows = [];
try {
  for (const route of ROUTES) {
    for (const form of ['mobile', 'desktop']) {
      const config = form === 'desktop' ? desktopConfig : undefined;
      // Simulated throttling (Lighthouse's default) for a stable CI signal. It replays the LCP
      // element of an unthrottled load, where the app covers index.html's poster before that
      // paints, so it overstates a poster-first page's mobile LCP; `--applied` measures the
      // real paint order (slower and noisier, and the always-animating globe on software GL
      // leaves no quiet window for TTI). See DECISIONS.md, phase 9.
      const throttlingMethod = args.includes('--applied') ? 'devtools' : 'simulate';
      const result = await lighthouse(`${base}${route.hash}`, { port: chrome.port, output: 'html', logLevel: 'error', throttlingMethod, onlyCategories: ['performance', 'accessibility', 'best-practices'] }, config);
      const { categories, audits } = result.lhr;
      const perf = Math.round(categories.performance.score * 100);
      const a11y = Math.round(categories.accessibility.score * 100);
      const bp = Math.round(categories['best-practices'].score * 100);
      const lcp = audits['largest-contentful-paint']?.displayValue ?? '—';
      writeFileSync(resolve(out, `${route.name}-${form}.html`), result.report);
      const perfOk = perf >= TARGETS[form];
      rows.push(`${route.name.padEnd(8)} ${form.padEnd(8)} perf ${String(perf).padStart(3)}${perfOk ? '' : ` (target ${TARGETS[form]})`}  a11y ${a11y}  best-practices ${bp}  LCP ${lcp}`);
      if (a11y < 100) {
        failed = true;
        const bad = Object.values(audits).filter((a) => a.score === 0 && result.lhr.categories.accessibility.auditRefs.some((r) => r.id === a.id));
        rows.push(`  accessibility failures: ${bad.map((a) => a.id).join(', ')}`);
      }
      if (!perfOk) {
        if (strict) failed = true;
        console.log(`::warning::Lighthouse ${route.name} ${form}: performance ${perf} < ${TARGETS[form]}`);
      }
    }
  }
} finally {
  await chrome.kill();
}
console.log(rows.join('\n'));
console.log(`Reports: ${out}`);
if (failed) {
  console.error('Lighthouse check failed.');
  process.exit(1);
}
