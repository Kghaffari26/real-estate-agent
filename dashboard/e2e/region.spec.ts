/**
 * The regional market view (v3 R2): Orange County down to city and ZIP on the atlas.
 * The panel shows exactly the agent's published figures, the drill-down lives in the
 * URL, the table lists every ZIP and city, area search counts ZIPs by the pure
 * function, axe is clean in both themes, and without region files nothing breaks.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtChange, fmtMetric } from '../src/atlas/format';
import { countySearch } from '../src/lib/area';
import { formatValue } from '../src/lib/format';
import { ranked, zipAreaInputs } from '../src/viewmodels/region';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, 'public/data', p), 'utf8'));
const index = read('latest.json');
const region = read('regions/orange-county.json');
const reg = new Map(index.metric_registry.map((r: { key: string }) => [r.key, r]));
const PRICE = reg.get('median_sale_price') as never;
const OC = '/explore?region=orange-county';

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`the Orange County view renders, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, OC);
    const panel = page.getByTestId('region-panel').first();
    await expect(panel).toBeAttached({ timeout: 20_000 });
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
    expect(serious(results.violations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('the county panel shows the agent’s summary and ranks cities, leaving low-sample ones out', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is a bottom sheet on phones');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, OC);
  const panel = page.getByTestId('region-panel');
  await expect(panel.getByTestId('region-title')).toHaveText('Orange County');
  const kpis = panel.getByTestId('region-kpis');
  await expect(kpis).toContainText(fmtMetric(PRICE, region.summary.latest.median_sale_price.value));
  await expect(kpis).toContainText(`${fmtChange(PRICE, region.summary.latest.median_sale_price.yoy)} YoY`);
  const expected = ranked(region.cities, 'median_sale_price');
  const items = panel.getByTestId('region-list').getByRole('listitem');
  await expect(items).toHaveCount(expected.length);
  await expect(items.first()).toContainText(expected[0]!.name);
  await expect(items.first()).toContainText(fmtMetric(PRICE, expected[0]!.latest.median_sale_price!.value));
});

test('drill down county → city → ZIP, in the URL; the breadcrumb goes back', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop panel');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, OC);
  const panel = page.getByTestId('region-panel');
  await panel.getByRole('button', { name: /Irvine/ }).first().click();
  const irvine = region.cities.find((c: { name: string }) => c.name === 'Irvine');
  await expect(page).toHaveURL(new RegExp(`[?&]city=${irvine.id}`));
  await expect(panel.getByTestId('region-title')).toHaveText('Irvine');
  await expect(panel.getByTestId('region-list').getByRole('listitem')).toHaveCount(ranked(region.zips.filter((z: { id: string }) => irvine.zips.includes(z.id)), 'median_sale_price').length);
  await panel.getByRole('button', { name: /^\d+\s*92618 · Irvine/ }).click();
  await expect(page).toHaveURL(/[?&]zip=92618/);
  await expect(panel.getByTestId('region-title')).toHaveText('92618 · Irvine');
  const z = region.zips.find((x: { id: string }) => x.id === '92618');
  await expect(panel.getByTestId('region-kpis')).toContainText(fmtMetric(PRICE, z.latest.median_sale_price.value));
  await panel.getByRole('navigation', { name: 'Region breadcrumb' }).getByRole('button', { name: 'Orange County' }).click();
  await expect(panel.getByTestId('region-title')).toHaveText('Orange County');
  await expect(page).not.toHaveURL(/[?&](zip|city)=/);
});

test('a low-sample ZIP says so and has no rank', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop panel');
  const low = region.zips.find((x: { low_sample: boolean; lat: number | null }) => x.low_sample);
  test.skip(!low, 'no low-sample ZIP in this data');
  await gotoView(page, `${OC}&zip=${low.id}`);
  await expect(page.getByTestId('low-sample')).toContainText(`Only ${formatValue(low.latest.homes_sold.value, 'count')} homes sold`);
});

test('the table lists every ZIP and city, sorts, and exports CSV', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop table');
  await gotoView(page, `${OC}&view=table`);
  const table = page.getByTestId('region-table');
  await expect(table.locator('tbody tr')).toHaveCount(region.zips.length);
  await table.getByRole('radio', { name: /Cities/ }).check({ force: true });
  await expect(table.locator('tbody tr')).toHaveCount(region.cities.length);
  await expect(table.getByRole('columnheader', { name: /Median price/ })).toHaveAttribute('aria-sort', 'descending');
  const download = page.waitForEvent('download');
  await table.getByTestId('region-csv').click();
  expect((await download).suggestedFilename()).toMatch(/^metro-pulse-orange-county-city-.*\.csv$/);
});

test('the idle panel opens the region; area search counts ZIPs by the pure function', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop panel');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore');
  await page.getByTestId('open-region-orange-county').click();
  await expect(page).toHaveURL(/[?&]region=orange-county/);
  await expect(page.getByTestId('region-panel')).toBeAttached();
  const pin = { lat: 33.6846, lon: -117.8265 };
  await gotoView(page, `${OC}&pin=${pin.lat},${pin.lon}&r=10`);
  const expected = countySearch(pin, 10, [{ slug: region.slug, areas: zipAreaInputs(region) }]);
  const block = page.getByTestId('area-zips');
  await expect(block.getByTestId('area-zips-count')).toHaveText(String(expected.counties.length));
  await expect(block.getByTestId('area-zips-price')).toHaveText(formatValue(expected.price, 'currency_compact'));
});

test('without region files the atlas is unchanged and ?region= is ignored', async ({ page, consoleErrors }) => {
  await page.route(/\/data\/latest\.json/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...index, regions: [] }) }));
  await gotoView(page, OC);
  await expect(page.locator('[data-atlas-mode]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId('region-panel')).toHaveCount(0);
  await expect(page.getByTestId('open-region-orange-county')).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
