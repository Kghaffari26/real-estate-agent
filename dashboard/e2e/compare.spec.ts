/**
 * The compare arena and the v2 methodology page (spec §7.5, §7.6, M7): both themes
 * WCAG 2.1 AA axe-clean and fitting the viewport; the arena's add/remove, metric and
 * range controls live in the URL, the crosshair is shared across charts, the table
 * marks leaders, and the low tier draws the SVG trio. Methodology carries the credits.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, expectNoHorizontalScroll, gotoView, revealAll, test } from './fixtures';

const TRIO = '/compare?m=pittsburgh-pa,houston-tx,austin-tx';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const PAGES = [
  { name: 'compare arena', path: TRIO + '&metrics=median_sale_price,inventory', h1: /Pittsburgh · Houston · Austin/ },
  { name: 'compare empty', path: '/compare', h1: /Compare metros/ },
  { name: 'methodology', path: '/methodology', h1: /Numbers come from code/ },
];

for (const p of PAGES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${p.name} (${theme}): renders, axe-clean, fits the viewport`, async ({ page, consoleErrors }) => {
      await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await gotoView(page, p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible();
      await revealAll(page);
      await page.waitForLoadState('networkidle');
      expect(await axe(page), 'axe violations').toEqual([]);
      await expectNoHorizontalScroll(page);
      expect(consoleErrors).toEqual([]);
    });
  }
}

test('arena: add, remove, metrics (max 2), indexed, range, leaders', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await gotoView(page, '/compare?m=pittsburgh-pa');
  await page.getByRole('combobox', { name: 'Add a metro to compare' }).fill('Houston');
  await page.getByRole('option', { name: 'Houston, TX' }).click();
  await expect(page).toHaveURL(/m=pittsburgh-pa(%2C|,)houston-tx/);
  await expect(page.getByTestId('arena-legend').getByRole('listitem')).toHaveCount(2);
  // A third metric replaces the oldest of the two.
  await page.getByRole('button', { name: 'Active inventory' }).click();
  await page.getByRole('button', { name: 'Homes sold' }).click();
  await expect(page.getByTestId('arena-chart-median_sale_price')).toHaveCount(0);
  await expect(page.getByTestId('arena-chart-inventory')).toBeVisible();
  await expect(page.getByTestId('arena-chart-homes_sold')).toBeVisible();
  await page.getByRole('switch', { name: /Index to 100/ }).click();
  await expect(page).toHaveURL(/indexed=1/);
  await expect(page.getByText('Active inventory, indexed')).toBeVisible();
  await page.getByText('All', { exact: true }).click();
  await expect(page).toHaveURL(/range=All/);
  await expect(page.getByText(/Monthly since January 2012/).first()).toBeVisible();
  await expect(page.getByTestId('compare-table').locator('td[data-leader]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove Houston, TX' }).click();
  await expect(page.getByRole('columnheader', { name: /Houston/ })).toHaveCount(0);
});

test('arena: the crosshair is shared across charts', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await gotoView(page, TRIO + '&metrics=median_sale_price,inventory');
  const first = page.getByTestId('arena-chart-median_sale_price').getByRole('img');
  await first.focus();
  await page.keyboard.press('Home');
  const month = await page.getByTestId('arena-chart-median_sale_price').locator('figcaption span').last().textContent();
  await expect(page.getByTestId('arena-chart-inventory').locator('figcaption span').last()).toHaveText(month ?? '');
});

test('arena: "Add from map" carries the selection; the low tier draws the SVG trio', async ({ page }) => {
  await gotoView(page, TRIO + '&tier=low');
  await expect(page.locator('[data-arena-mode="2d"]')).toBeAttached();
  await expect(page.locator('[data-arena-mode] canvas')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add from map' })).toHaveAttribute('href', /#\/explore\?sel=pittsburgh-pa,houston-tx,austin-tx/);
});

test('methodology: credits, procedural note, deep link; /about redirects', async ({ page }) => {
  await gotoView(page, '/about?section=flags');
  await expect(page).toHaveURL(/#\/methodology\?section=flags/);
  await expect(page.getByRole('heading', { name: 'How flags are computed' })).toBeInViewport();
  await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mapzen Terrain Tiles' })).toBeVisible();
  await expect(page.getByText(/there is no generated media/)).toBeVisible();
});

test('unknown routes get the v2 not-found page', async ({ page }) => {
  await gotoView(page, '/nowhere');
  await expect(page.getByRole('heading', { level: 1, name: 'There’s nothing at this address.' })).toBeVisible();
});
