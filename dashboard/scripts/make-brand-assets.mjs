#!/usr/bin/env node
/**
 * Renders public/og.png (1200×630) and public/apple-touch-icon.png (180×180) from
 * HTML with Playwright. Run after a rebrand: `npm run brand-assets`.
 * Reads the name/tagline from src/config/brand.ts (parsed, not imported, to stay
 * dependency-free) and the mark geometry below (keep in sync with Logo.tsx).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const brandSrc = readFileSync(resolve(here, '../src/config/brand.ts'), 'utf8');
const pick = (key) => brandSrc.match(new RegExp(`${key}: '([^']+)'`))?.[1] ?? '';
const NAME = pick('name');
const TAGLINE = pick('tagline');
const ACCENT = '#4f46e5';
const MARK = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${ACCENT}"/><path d="M7 22V15.5M12 22V12M20 22V14M25 22V10" stroke="#fff" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round"/><path d="M5.5 18.5h5l2.5-7 4 12 3-8h6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const interWoff2 = readFileSync(resolve(here, '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const fontFace = `<style>@font-face{font-family:'Inter Variable';src:url(data:font/woff2;base64,${interWoff2}) format('woff2');font-weight:100 900}</style>`;
const font = `font-family: 'Inter Variable', system-ui, sans-serif; font-feature-settings: 'cv11','ss01';`;

const og = `<!doctype html><html><head>${fontFace}</head><body style="margin:0;width:1200px;height:630px;${font};background:#0b0c0e;color:#ededf0;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(800px 400px at 85% 10%, rgba(79,70,229,.35), transparent 60%)"></div>
  <svg style="position:absolute;right:0;bottom:0" width="600" height="300" viewBox="0 0 760 360" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b8df8" stop-opacity=".35"/><stop offset="1" stop-color="#8b8df8" stop-opacity="0"/></linearGradient></defs>
    <path d="M0 300 C80 290 120 250 180 255 S300 200 360 210 S470 150 540 160 S650 90 760 70 L760 360 L0 360Z" fill="url(#g)"/>
    <path d="M0 300 C80 290 120 250 180 255 S300 200 360 210 S470 150 540 160 S650 90 760 70" fill="none" stroke="#8b8df8" stroke-width="4"/>
    <circle cx="756" cy="70" r="8" fill="#8b8df8" stroke="#0b0c0e" stroke-width="4"/>
  </svg>
  <div style="position:absolute;left:80px;top:90px;display:flex;align-items:center;gap:22px">${MARK(72)}<span style="font-size:52px;font-weight:700;letter-spacing:-1px">${NAME}</span></div>
  <div style="position:absolute;left:80px;top:215px;font-size:38px;font-weight:600;letter-spacing:-.5px;max-width:640px;line-height:1.2">${TAGLINE}</div>
  <div style="position:absolute;left:80px;top:330px;font-size:24px;color:#b0b1b8;max-width:560px;line-height:1.45">50 metros · prices, inventory, speed, rents and mortgage rates · AI analyst notes checked against the numbers</div>
  <div style="position:absolute;left:80px;bottom:60px;font-size:18px;color:#8e8f98">Data: Redfin, Zillow, FRED, U.S. Census Bureau</div>
</body></html>`;
const icon = `<!doctype html><html><body style="margin:0;width:180px;height:180px;background:${ACCENT};display:flex;align-items:center;justify-content:center">${MARK(180).replace('rx="8"', 'rx="0"')}</body></html>`;

const browser = await chromium.launch(process.env.CI ? {} : { executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [html, w, h, out] of [[og, 1200, 630, 'og.png'], [icon, 180, 180, 'apple-touch-icon.png']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: resolve(here, '../public', out) });
  console.log(`wrote public/${out}`);
}
await browser.close();
