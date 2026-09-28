import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const ROUTES: Array<{ name: string; path: string; ready: RegExp }> = [
  { name: 'overview', path: '/', ready: /U\.S\. housing market/ },
  { name: 'metros', path: '/metros', ready: /^Metros$/ },
  { name: 'metro detail', path: '/metro/pittsburgh-pa', ready: /Pittsburgh, PA/ },
  { name: 'compare', path: '/compare?m=pittsburgh-pa,houston-tx,austin-tx', ready: /Compare metros/ },
  { name: 'about', path: '/about', ready: /About and methodology/ },
];

for (const route of ROUTES) {
  test(`${route.name}: renders, is axe-clean and fits the viewport`, async ({ page, consoleErrors }) => {
    await gotoView(page, route.path);
    await expect(page.getByRole('heading', { level: 1, name: route.ready })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(summary, 'axe violations').toEqual([]);

    await expectNoHorizontalScroll(page);
    expect(consoleErrors).toEqual([]);
  });
}

test('dark theme is axe-clean on the overview', async ({ page }) => {
  await gotoView(page, '/');
  await page.getByLabel('Color theme').selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

// The badge shows only when fetch-data fell back to the committed snapshot.
const dataSource = (() => {
  try {
    return JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/source.json'), 'utf8')).source as string;
  } catch {
    return 'sample';
  }
})();

test('shows the data-source badge and the national data', async ({ page }) => {
  await gotoView(page, '/');
  await expect(page.getByText('Sample data', { exact: true })).toHaveCount(dataSource === 'sample' ? 1 : 0);
  await expect(page.getByRole('heading', { name: 'National brief' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Market temperature \d+ out of 100/ })).toBeVisible();
});

test('overview metric toggle and range are deep-linked', async ({ page }) => {
  await gotoView(page, '/?metric=inventory&range=1Y');
  const chart = page.locator('#national-series');
  await expect(chart.getByRole('combobox', { name: 'Metric' })).toHaveValue('inventory');
  await expect(chart.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
  await chart.getByRole('button', { name: 'All' }).click();
  await expect(page).toHaveURL(/range=All/);
});

test('quick search navigates to a metro with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile === true);
  await gotoView(page, '/');
  const search = page.getByRole('combobox', { name: 'Quick search metros' });
  await search.fill('pitts');
  await expect(page.getByRole('option', { name: 'Pittsburgh, PA' })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('ArrowUp');
  await search.press('Enter');
  await expect(page).toHaveURL(/#\/metro\/pittsburgh-pa/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pittsburgh, PA' })).toBeVisible();
});

test('metros table sorts, filters and links to a metro', async ({ page }) => {
  await gotoView(page, '/metros?view=table');
  const table = page.getByRole('table', { name: /Metros with their latest value/ });
  await expect(table.getByRole('row')).toHaveCount(51);
  await page.getByRole('searchbox', { name: 'Search' }).fill('san');
  await expect(page).toHaveURL(/q=san/);
  const rows = await table.getByRole('row').count();
  expect(rows).toBeLessThan(51);
  await page.getByRole('searchbox', { name: 'Search' }).fill('');
  await table.getByRole('button', { name: /^Metro/ }).click();
  await expect(table.getByRole('columnheader', { name: /Metro/ }).first()).toHaveAttribute('aria-sort', 'ascending');
  await table.getByRole('link', { name: 'Anaheim, CA' }).click();
  await expect(page).toHaveURL(/#\/metro\/anaheim-ca/);
});

test('metros map shows a marker per metro and a legend', async ({ page }) => {
  await gotoView(page, '/metros');
  await expect(page.locator('.leaflet-interactive')).toHaveCount(50);
  await expect(page.getByText('No data', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View as table' }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page.locator('.leaflet-container')).toHaveCount(0);
});

test('metro detail: rate overlay, calculator and investigation', async ({ page }) => {
  await gotoView(page, '/metro/pittsburgh-pa?rate=1');
  await expect(page.getByLabel('30-yr mortgage rate')).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Why this is happening' })).toBeVisible();
  const calc = page.getByRole('form', { name: 'Mortgage payment calculator' });
  await expect(calc.getByText('$1,468')).toBeVisible();
  await calc.getByLabel(/Down payment/).fill('10');
  await expect(calc.getByText('$1,652')).toBeVisible();
  await calc.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(calc.getByText('$1,468')).toBeVisible();
});

test('compare: add and remove metros, indexed toggle', async ({ page, isMobile }) => {
  test.skip(isMobile === true);
  await gotoView(page, '/compare?m=pittsburgh-pa');
  await page.getByRole('combobox', { name: 'Add a metro to compare' }).fill('Houston');
  await page.getByRole('option', { name: 'Houston, TX' }).click();
  await expect(page).toHaveURL(/m=pittsburgh-pa%2Chouston-tx|m=pittsburgh-pa,houston-tx/);
  await page.getByLabel('Index to 100').check();
  await expect(page.getByRole('heading', { name: /indexed, first month = 100/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Houston, TX' }).click();
  await expect(page.getByRole('columnheader', { name: 'Houston, TX' })).toHaveCount(0);
});

test('unknown metro shows not found', async ({ page }) => {
  await gotoView(page, '/metro/nowhere-zz');
  await expect(page.getByRole('heading', { level: 1, name: 'Metro not found' })).toBeVisible();
});
