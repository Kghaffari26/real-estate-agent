/**
 * The Explore atlas (spec §7.2, §12): renders in 3D with software WebGL, area search
 * numbers equal the pure function, scrubbing shows the published history, the table
 * view mirrors the map, keyboard paths work, and the forced low tier and reduced
 * motion both render. axe in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaSearch } from '../src/lib/area';
import { formatDelta, formatMonth, formatValue } from '../src/lib/format';
import { areaMetros, atlasMetros } from '../src/viewmodels/atlas';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(resolve(root, 'sample-data/latest.json'), 'utf8'));
const austinFile = JSON.parse(readFileSync(resolve(root, 'sample-data/metros/austin-tx.json'), 'utf8'));
const PHILLY = { lat: 39.9526, lon: -75.1652 };

type MapEl = HTMLElement & { __map?: { loaded: () => boolean; project: (ll: [number, number]) => { x: number; y: number } } };

async function waitForAtlas(page: Page, mode: '3d' | '2d' = '3d') {
  await expect(page.locator(`[data-atlas-mode="${mode}"]`)).toBeAttached({ timeout: 20_000 });
  if (mode !== '3d') return;
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('div')).some((d) => (d as MapEl).__map?.loaded()), undefined, { timeout: 20_000 });
}

/** Screen position of a coordinate on the live map. */
async function project(page: Page, lon: number, lat: number) {
  return page.evaluate(([x, y]) => {
    const el = Array.from(document.querySelectorAll('div')).find((d) => (d as MapEl).__map) as MapEl;
    const p = el.__map!.project([x!, y!]);
    const r = el.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }, [lon, lat]);
}

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`explore renders the 3D atlas, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, '/explore');
    await waitForAtlas(page);
    await expect(page.getByRole('heading', { level: 1, name: /Atlas: Median sale price/ })).toBeAttached();
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
    expect(serious(results.violations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test("area search: the panel shows exactly the pure function's numbers", async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the panel is in a bottom sheet on phones');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore?pin=39.9526,-75.1652&r=100');
  await waitForAtlas(page);
  const expected = areaSearch(PHILLY, 100, areaMetros(atlasMetros(index)));
  const panel = page.getByTestId('area-panel');
  await expect(panel.getByTestId('area-price')).toHaveText(formatValue(expected.price, 'currency_compact'));
  await expect(panel.getByTestId('area-yoy')).toHaveText(formatDelta(expected.yoy, 'percent_signed'));
  await expect(panel.getByTestId('area-inventory')).toHaveText(formatValue(expected.inventory, 'count'));
  await expect(panel.getByTestId('area-count')).toHaveText(`${expected.metros.length} metros inside`);
  await expect(panel.getByRole('heading', { name: /100 mi around\s*Philadelphia, PA/ })).toBeVisible();
  // The radius slider rewrites the URL and the aggregate.
  const radius = panel.getByRole('slider', { name: 'Radius' });
  await radius.focus();
  await page.keyboard.press('Home');
  await expect(page).toHaveURL(/[?&]r=10(&|$)/);
  const small = areaSearch(PHILLY, 10, areaMetros(atlasMetros(index)));
  await expect(panel.getByTestId('area-count')).toHaveText(`${small.metros.length} ${small.metros.length === 1 ? 'metro' : 'metros'} inside`);
});

test('time machine: scrubbing shows the published history for the selected metro', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore?sel=austin-tx');
  await waitForAtlas(page);
  const panel = page.getByTestId('metro-panel');
  const latest = index.metros.find((m: { slug: string }) => m.slug === 'austin-tx').latest.median_sale_price;
  await expect(panel.getByTestId('metro-value')).toHaveText(formatValue(latest.value, 'currency'));
  const month = page.getByRole('slider', { name: 'Month' });
  await month.focus();
  await page.keyboard.press('Home');
  const dates: string[] = austinFile.series.dates;
  const s: number[] = austinFile.series.median_sale_price;
  await expect(month).toHaveAttribute('aria-valuetext', formatMonth(dates[0], true));
  await expect(panel.getByTestId('metro-value')).toHaveText(formatValue(s[0], 'currency'), { timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`t=${dates[0]!.slice(0, 7)}`));
  // ',' and '.' step the month from anywhere on the page
  await page.locator('body').press('.');
  await expect(panel.getByTestId('metro-value')).toHaveText(formatValue(s[1], 'currency'));
  // Month 13: the change is read from the published series (value vs 12 months earlier).
  for (let i = 0; i < 12; i++) await page.locator('body').press('.');
  await expect(panel.getByTestId('metro-change')).toHaveText(formatDelta(s[13]! / s[1]! - 1, 'percent_signed'));
});

test('table view mirrors the map and follows the area', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore');
  await waitForAtlas(page);
  await page.locator('body').press('t');
  const table = page.getByTestId('atlas-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(50);
  const austin = index.metros.find((m: { slug: string }) => m.slug === 'austin-tx').latest.median_sale_price;
  await expect(table.locator('tr[data-slug="austin-tx"] [data-col="value"]')).toHaveText(formatValue(austin.value, 'currency'));
  await page.locator('body').press('t');
  await expect(table).toBeHidden();
  await gotoView(page, '/explore?view=table&pin=39.9526,-75.1652&r=100');
  await expect(page.getByTestId('atlas-table').locator('tbody tr')).toHaveCount(areaSearch(PHILLY, 100, areaMetros(atlasMetros(index))).metros.length);
});

test('forced low tier: the designed 2D atlas, same data, axe-clean', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore?tier=low&pin=39.9526,-75.1652&r=120');
  await waitForAtlas(page, '2d');
  await expect(page.locator('[data-atlas-mode="2d"] svg[role="img"] [data-slug]')).toHaveCount(50);
  const results = await new AxeBuilder({ page }).analyze();
  expect(serious(results.violations)).toEqual([]);
});

test('reduced motion: clicking empty map drops a pin; Escape clears it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/explore');
  await waitForAtlas(page);
  const gulf = await project(page, -90.5, 25.5); // open water: no column there
  await page.mouse.click(gulf.x, gulf.y);
  await expect(page).toHaveURL(/pin=/);
  await expect(page.getByTestId('area-panel')).toBeVisible();
  await page.locator('body').press('Escape');
  await expect(page).not.toHaveURL(/pin=/);
});

test('shortcut sheet opens with ? and closes with Escape', async ({ page }) => {
  await gotoView(page, '/explore');
  await waitForAtlas(page);
  await page.locator('body').press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('deck.gl × MapLibre 6 patch: deck picks what MapLibre projects', async ({ page, consoleErrors }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Flat layer at a fixed camera: each metro is a dot exactly at its display position.
  await gotoView(page, '/explore?style=flat&cam=-96.2,37.4,3.6,0,0');
  await waitForAtlas(page);
  const austin = atlasMetros(index).find((m) => m.slug === 'austin-tx')!;
  const result = await page.evaluate(
    ([lon, lat]) => {
      type Probe = HTMLElement & {
        __map?: { transform?: unknown; painter?: { transform?: unknown }; project: (ll: [number, number]) => { x: number; y: number } };
        __overlay?: { pickObject: (o: { x: number; y: number; radius: number }) => { object?: { slug?: string } } | null };
      };
      const el = Array.from(document.querySelectorAll('div')).find((d) => (d as Probe).__map) as Probe;
      const map = el.__map!;
      const p = map.project([lon!, lat!]);
      return {
        aliased: map.transform !== undefined && map.transform === map.painter?.transform,
        picked: el.__overlay!.pickObject({ x: p.x, y: p.y, radius: 3 })?.object?.slug ?? null,
      };
    },
    [austin.lon, austin.lat],
  );
  expect(result.aliased, 'map.transform is the painter transform (patch active)').toBe(true);
  expect(result.picked, "deck's picking agrees with MapLibre's projection").toBe('austin-tx');
  expect(consoleErrors).toEqual([]);
});

test('height legend states the scale in use', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await gotoView(page, '/explore');
  await waitForAtlas(page);
  const max = Math.max(...atlasMetros(index).map((m) => m.latest.median_sale_price?.value ?? 0));
  await expect(page.getByTestId('height-legend')).toHaveText(`Height: from zero to ${formatValue(max, 'currency')}, proportional.`);
  await page.getByText('YoY', { exact: true }).first().click();
  await expect(page).toHaveURL(/[?&]h=yoy/);
  await expect(page.getByTestId('height-legend')).toContainText('Up = rising, down = falling');
});
