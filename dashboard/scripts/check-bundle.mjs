#!/usr/bin/env node
/**
 * Performance budget: the JavaScript a first visit downloads (the entry script plus
 * every <link rel="modulepreload"> in dist/index.html) must stay under BUDGET_KB
 * gzipped. Lazy chunks (charts, map, secondary pages) are listed but not counted.
 * Usage: node scripts/check-bundle.mjs [--budget 300]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const i = process.argv.indexOf('--budget');
const BUDGET_KB = i > -1 ? Number(process.argv[i + 1]) : 300;

const html = readFileSync(join(root, 'index.html'), 'utf8');
const initial = [...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+\.js)"/g)].map((m) => m[1].replace(/^.*\/assets\//, 'assets/'));
const gz = (file) => gzipSync(readFileSync(join(root, file)), { level: 9 }).length / 1024;

const assets = readdirSync(join(root, 'assets')).filter((f) => f.endsWith('.js'));
let total = 0;
console.log('Initial JavaScript (gzipped):');
for (const file of initial) {
  const kb = gz(file);
  total += kb;
  console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(`  ${total.toFixed(1).padStart(7)} KB  total (budget ${BUDGET_KB} KB)`);
console.log('Lazy chunks (gzipped, not counted):');
for (const file of assets.map((f) => `assets/${f}`).filter((f) => !initial.includes(f)).sort((a, b) => statSync(join(root, b)).size - statSync(join(root, a)).size).slice(0, 8)) {
  console.log(`  ${gz(file).toFixed(1).padStart(7)} KB  ${file}`);
}
if (total > BUDGET_KB) {
  console.error(`\nOver budget by ${(total - BUDGET_KB).toFixed(1)} KB: lazy-load something (see vite.config.ts manualChunks).`);
  process.exit(1);
}
