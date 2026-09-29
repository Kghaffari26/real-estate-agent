/**
 * The agent's §6.5-6.7 files in the dashboard (spec P8): area search picks up counties
 * (numbers equal the pure function on the published files), the time machine's rail
 * shows the agent's events, the weekly pulse runs as a ticker and on the dossier, the
 * dossier lists its counties, and the site renders fully without any of these files.
 */
import type { Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countySearch, metrosNearRing } from '../src/lib/area';
import { formatDelta, formatValue } from '../src/lib/format';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, 'sample-data', p), 'utf8'));
const index = read('latest.json');
const pulse = read('pulse.json');
const areaFiles = Object.fromEntries(readdirSync(resolve(root, 'sample-data/areas')).map((f) => [f.replace('.json', ''), read(`areas/${f}`)]));
const PHILLY = { lat: 39.95, lon: -75.16 };

async function waitForAtlas(page: Page) {
  await expect(page.locator('[data-atlas-mode]')).toBeAttached({ timeout: 20_000 });
}

test('area search: counties inside the ring equal the pure function on the published files', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is in a bottom sheet on phones');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore?pin=39.9500,-75.1600&r=40');
  await waitForAtlas(page);
  const listed = new Set(index.areas.map((a: { slug: string }) => a.slug));
  const near = metrosNearRing(PHILLY, 40, index.metros.filter((m: { slug: string }) => listed.has(m.slug)));
  const expected = countySearch(PHILLY, 40, near.map((s) => areaFiles[s]));
  expect(expected.counties.length).toBeGreaterThan(2);
  const block = page.getByTestId('area-counties');
  await expect(block.getByTestId('area-county-count')).toHaveText(String(expected.counties.length));
  await expect(block.getByTestId('area-county-price')).toHaveText(formatValue(expected.price, 'currency_compact'));
  await expect(block).toContainText(expected.counties[0]!.name);
});

test('time machine: the rail shows the agent’s events and jumps to them', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'labels are dots on phones');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore');
  await waitForAtlas(page);
  const high = page.getByRole('button', { name: 'Jump to 30-yr high 7.79% · Oct 2023' });
  await expect(high).toBeAttached();
  await high.click();
  await expect(page.getByRole('slider', { name: 'Month' })).toHaveAttribute('aria-valuetext', 'October 2023');
  // Markers are thinned to 24 px targets; the Moments menu lists every published event on
  // the axis (the time machine starts Jan 2013, so each month has a YoY; 2012 events fall off).
  const menu = page.getByRole('combobox', { name: 'Jump to a moment' });
  const onAxis = read('events.json').events.filter((e: { date: string }) => e.date >= '2013-01-01').length;
  await expect(menu.locator('option')).toHaveCount(onAxis + 1);
  await menu.selectOption({ label: 'U.S. prices turn down (−1.9% YoY) · Mar 2023' });
  await expect(page.getByRole('slider', { name: 'Month' })).toHaveAttribute('aria-valuetext', 'March 2023');
});

test('the weekly pulse ticker: every metro, fastest first, pausable; still under reduced motion', async ({ page }) => {
  await gotoView(page, '/');
  const ticker = page.getByTestId('pulse-ticker');
  await ticker.scrollIntoViewIfNeeded();
  const items = ticker.locator('li:not([aria-hidden])');
  await expect(items).toHaveCount(Object.keys(pulse.metros).length);
  const fastest = Object.entries(pulse.yoy as Record<string, { median_sale_price: number | null }>).sort((a, b) => (b[1].median_sale_price ?? -1) - (a[1].median_sale_price ?? -1))[0]!;
  await expect(items.first().getByRole('link')).toHaveAttribute('href', `#/metro/${fastest[0]}`);
  await expect(items.first()).toContainText(formatDelta(fastest[1].median_sale_price, 'percent_signed'));
  const pause = ticker.getByRole('button', { name: 'Pause the pulse ticker' });
  await pause.click();
  await expect(ticker.getByRole('button', { name: 'Play the pulse ticker' })).toHaveAttribute('aria-pressed', 'true');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('pulse-ticker').getByRole('region', { name: 'Weekly pulse by metro' })).toBeAttached();
  await expect(page.getByTestId('pulse-ticker').getByRole('button')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test('dossier: the last 12 weeks and county by county, from the published files', async ({ page }) => {
  await gotoView(page, '/metro/philadelphia-pa');
  const weekly = page.getByTestId('weekly-pulse');
  await weekly.scrollIntoViewIfNeeded();
  const price = pulse.metros['philadelphia-pa'].median_sale_price.at(-1);
  await expect(weekly).toContainText(formatValue(price, 'currency'));
  await expect(weekly).toContainText(`${formatDelta(pulse.yoy['philadelphia-pa'].median_sale_price, 'percent_signed')} YoY`);
  const rows = page.getByTestId('county-table').locator('tbody tr');
  await expect(rows).toHaveCount(areaFiles['philadelphia-pa'].areas.length);
  await expect(rows.first()).toContainText('Philadelphia County');
});

test('without the extension files the site still renders everything else', async ({ page, consoleErrors }) => {
  const bare = { ...index, events: null, pulse: null, areas: [] };
  await page.route(/\/data\/latest\.json/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bare) }));
  await page.route(/\/data\/(events|pulse)\.json|\/data\/areas\//, (route) => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/');
  await expect(page.getByRole('heading', { name: 'What the numbers say' })).toBeAttached();
  await expect(page.getByTestId('pulse-ticker')).toHaveCount(0);
  await gotoView(page, '/metro/philadelphia-pa');
  await expect(page.getByRole('heading', { name: 'What drives the temperature' })).toBeVisible();
  await expect(page.getByTestId('weekly-pulse')).toHaveCount(0);
  await expect(page.getByTestId('county-table')).toHaveCount(0);
  await gotoView(page, '/explore?pin=39.9500,-75.1600&r=40');
  await expect(page.getByTestId('area-panel').first()).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId('area-counties')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('a listed but unreadable file is simply not shown', async ({ page, consoleErrors }) => {
  await page.route(/\/data\/pulse\.json/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"weeks": "nope"}' }));
  await gotoView(page, '/metro/philadelphia-pa');
  await expect(page.getByTestId('county-table')).toBeAttached();
  await expect(page.getByTestId('weekly-pulse')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
