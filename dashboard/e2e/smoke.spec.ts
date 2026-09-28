import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, gotoView, revealAll, test } from './fixtures';

const here = dirname(fileURLToPath(import.meta.url));
// The Sample marker shows only when fetch-data fell back to the committed snapshot.
const dataSource = (() => {
  try {
    return JSON.parse(readFileSync(resolve(here, '../public/data/source.json'), 'utf8')).source as string;
  } catch {
    return 'sample';
  }
})();
const latest = JSON.parse(readFileSync(resolve(here, '../public/data/latest.json'), 'utf8')) as { investigations: { slug: string }[] };
const investigated = latest.investigations[0]?.slug ?? 'pittsburgh-pa';

const ROUTES: Array<{ name: string; path: string; ready: RegExp }> = [
  { name: 'overview', path: '/', ready: /./ },
  { name: 'metros', path: '/metros', ready: /^Metros$/ },
  { name: 'metro detail', path: `/metro/${investigated}`, ready: /, [A-Z]{2}/ },
  { name: 'compare', path: '/compare?m=pittsburgh-pa,houston-tx,austin-tx', ready: /Compare metros/ },
  { name: 'about', path: '/about', ready: /Methodology/ },
];

async function ready(page: Page, heading: RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible();
  await revealAll(page); // charts and the map load as they near the viewport
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForLoadState('networkidle');
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const route of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${route.name} (${theme}): renders, axe-clean, fits the viewport`, async ({ page, consoleErrors }) => {
      await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
      await gotoView(page, route.path);
      await ready(page, route.ready);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
      expect(await axe(page), 'axe violations').toEqual([]);
      await expectNoHorizontalScroll(page);
      expect(consoleErrors).toEqual([]);
    });
  }
}

test('freshness chip and national data', async ({ page }) => {
  await gotoView(page, '/');
  const chip = page.getByRole('link', { name: /20\d\d/ }).first();
  await expect(chip).toBeVisible();
  await expect(chip.getByText('Sample', { exact: true })).toHaveCount(dataSource === 'sample' ? 1 : 0);
  await expect(page.getByRole('img', { name: /Market temperature \d+ out of 100/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The national picture' })).toBeVisible();
});

test('overview chart controls are deep-linked', async ({ page }) => {
  await gotoView(page, '/?metric=inventory&range=1Y');
  const card = page.locator('#national-trends');
  await expect(card.getByRole('combobox', { name: 'Metric' })).toHaveValue('inventory');
  await expect(card.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'All' }).click();
  await expect(page).toHaveURL(/range=All/);
});

test('command palette (Ctrl+K) navigates to a metro', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await gotoView(page, '/');
  await ready(page, /./);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('pittsb');
  await expect(dialog.getByRole('option', { name: /Pittsburgh, PA/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/metro\/pittsburgh-pa/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pittsburgh, PA' })).toBeVisible();
});

test('metros: map bubbles, table sort/filter/columns, CSV export', async ({ page }) => {
  await gotoView(page, '/metros');
  await ready(page, /^Metros$/);
  await expect(page.getByText(/Map unavailable/)).toHaveCount(0);
  await expect(page.locator('#map .maplibregl-canvas')).toHaveCount(1, { timeout: 15_000 });
  const table = page.getByRole('table', { name: /Metros with their latest values/ });
  await expect(table.getByRole('row')).toHaveCount(51);
  await page.getByRole('searchbox', { name: 'Search' }).fill('san');
  await expect(page).toHaveURL(/q=san/);
  expect(await table.getByRole('row').count()).toBeLessThan(51);
  await page.getByRole('searchbox', { name: 'Search' }).fill('');
  await table.getByRole('button', { name: /^Metro/ }).click();
  await expect(table.getByRole('columnheader', { name: /Metro/ }).first()).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: /^Columns/ }).click();
  await page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox').first().click();
  await expect(page).toHaveURL(/cols=/);
  await page.keyboard.press('Escape');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^metro-pulse-metros-.*\.csv$/);
  await page.getByRole('button', { name: 'View as table' }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);
  await table.getByRole('link', { name: 'Anaheim, CA' }).click();
  await expect(page).toHaveURL(/#\/metro\/anaheim-ca/);
});

test('metro detail: rate strip, U.S. comparison, calculator, cited metrics', async ({ page }) => {
  await gotoView(page, `/metro/${investigated}`);
  await ready(page, /, [A-Z]{2}/);
  await expect(page.getByText('30-yr fixed mortgage rate (U.S.)', { exact: true }).last()).toBeVisible();
  await page.getByText('Compare with U.S. (index to 100)').click();
  await expect(page).toHaveURL(/vs=1/);
  await expect(page.getByText('Indexed: first month in range = 100')).toBeVisible();
  // On phones the long page is collapsed into sections.
  const section = page.getByRole('button', { name: 'Affordability', exact: true });
  if (await section.isVisible()) await section.click();
  const calc = page.getByRole('form', { name: 'Mortgage payment calculator' });
  await calc.scrollIntoViewIfNeeded();
  const before = await calc.getByRole('status').textContent();
  await calc.getByRole('spinbutton', { name: /Down payment/ }).fill('50');
  await expect(calc.getByRole('status')).not.toHaveText(before ?? '');
  await calc.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(calc.getByRole('status')).toHaveText(before ?? '');
  const analysis = page.getByRole('button', { name: 'Analysis', exact: true });
  if ((await analysis.isVisible()) && (await analysis.getAttribute('aria-expanded')) === 'false') await analysis.click();
  const chip = page.locator('#investigation').getByRole('link').first();
  if (await chip.count()) {
    await chip.hover();
    await expect(page.locator('[data-metric].ring-2')).toHaveCount(1);
  }
});

test('compare: add, remove, indexed toggle, leaders', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await gotoView(page, '/compare?m=pittsburgh-pa');
  await page.getByRole('combobox', { name: 'Add a metro to compare' }).fill('Houston');
  await page.getByRole('option', { name: 'Houston, TX' }).click();
  await expect(page).toHaveURL(/m=pittsburgh-pa(%2C|,)houston-tx/);
  await page.getByText('Index to 100 (first month in range)').click();
  await expect(page.getByRole('heading', { name: /, indexed$/ })).toBeVisible();
  await expect(page.locator('td.bg-accent-soft').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove Houston, TX' }).click();
  await expect(page.getByRole('columnheader', { name: /Houston, TX/ })).toHaveCount(0);
});

test('copy link shows a toast; sidebar collapse is remembered', async ({ page, context }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoView(page, '/?range=1Y');
  await ready(page, /./);
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#\/\?range=1Y$/);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
});

test('print: the metro page drops the app chrome and adds a report header', async ({ page }) => {
  await gotoView(page, `/metro/${investigated}`);
  await ready(page, /, [A-Z]{2}/);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('banner')).toBeHidden();
  await expect(page.getByText('Metro report', { exact: false })).toBeVisible();
});

test('unknown metro shows not found', async ({ page }) => {
  await gotoView(page, '/metro/nowhere-zz');
  await expect(page.getByRole('heading', { level: 1, name: 'Metro not found' })).toBeVisible();
});
