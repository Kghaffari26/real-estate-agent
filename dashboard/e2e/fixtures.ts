import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test as base, expect, type Page } from '@playwright/test';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

const require = createRequire(import.meta.url);

/**
 * OpenFreeMap is unreachable from CI/sandboxes (and tests shouldn't depend on it),
 * so its style requests get an offline stand-in: land and state lines from us-atlas
 * as inline GeoJSON. Everything else about the map (MapLibre, bubbles, legend) is real.
 */
function standInStyle(dark: boolean) {
  const us = JSON.parse(readFileSync(require.resolve('us-atlas/states-10m.json'), 'utf8')) as Topology;
  const states = us.objects.states as GeometryCollection;
  const land = feature(us, states);
  const borders = mesh(us, states, (a, b) => a !== b);
  return {
    version: 8,
    name: 'offline stand-in',
    sources: { land: { type: 'geojson', data: land }, borders: { type: 'geojson', data: borders } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#101114' : '#eef1f4' } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': dark ? '#1d1f24' : '#fbfbfa' } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': dark ? '#34363d' : '#d9dadc', 'line-width': 0.8 } },
    ],
  };
}

const styles = { light: JSON.stringify(standInStyle(false)), dark: JSON.stringify(standInStyle(true)) };

export const test = base.extend<{ consoleErrors: string[] }>({
  // auto: every test gets the basemap stand-in, even if it doesn't read the errors.
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route(/tiles\.openfreemap\.org\/styles\/(\w+)/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: /dark/.test(route.request().url()) ? styles.dark : styles.light }),
    );
    await page.route(/tiles\.openfreemap\.org\/(?!styles)/, (route) => route.fulfill({ status: 204, body: '' }));
    // Terrain DEM tiles (the atlas's optional terrain) are external too.
    await page.route(/elevation-tiles-prod/, (route) => route.fulfill({ status: 204, body: '' }));
    await use(errors);
  }, { auto: true }],
});

export { expect };

/** Views are hash-routed: /real-estate-agent/#/metros */
export async function gotoView(page: Page, hashPath: string) {
  await page.goto(`./#${hashPath}`);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
}

/** Scroll through the page so deferred charts and the map load, then back to the top. */
export async function revealAll(page: Page) {
  await page.waitForLoadState('networkidle');
  const step = (page.viewportSize()?.height ?? 800) * 0.7;
  // Two passes: the page can grow while the first pass loads content.
  for (let pass = 0; pass < 2; pass++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height + step; y += step) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(150);
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}
