/**
 * Cross-app smoke checks. The v2 screens (Arrival, Atlas, Dossier, Styleguide) have
 * their own specs (arrival, explore, dossier, v2) with axe in both themes; this file
 * covers the v1-shell pages that remain (Compare, Methodology), the flows that span
 * screens (⌘K, redirects of old links, data versioning) and the phone layout.
 */
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

// v1-shell pages (full WCAG 2.1 AA axe, as before the v2 swap).
const ROUTES: Array<{ name: string; path: string; ready: RegExp }> = [
  { name: 'compare', path: '/compare?m=pittsburgh-pa,houston-tx,austin-tx', ready: /Compare metros/ },
  { name: 'about', path: '/about', ready: /Methodology/ },
];

async function ready(page: Page, heading: RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible();
  await revealAll(page); // charts load as they near the viewport
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

test('freshness and the national brief on the landing page', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/');
  // The freshness chip lives in the command bar from the lg breakpoint up.
  if (info.project.name !== 'mobile-360') {
    const chip = page.getByRole('link', { name: /Redfin through .*20\d\d/ });
    await expect(chip).toBeVisible();
    await expect(chip.getByText('Sample', { exact: true })).toHaveCount(dataSource === 'sample' ? 1 : 0);
  }
  await expect(page.getByRole('heading', { name: 'What the numbers say' })).toBeAttached();
  await expect(page.getByText('The national picture', { exact: true })).toBeAttached();
});

test('dossier chart controls are deep-linked (and v1 ?metric= links still work)', async ({ page }) => {
  await gotoView(page, '/metro/austin-tx?metric=inventory&range=1Y');
  await expect(page.getByRole('combobox', { name: 'Metric' })).toHaveValue('inventory');
  await expect(page.getByRole('radio', { name: '1Y' })).toBeChecked();
  await page.getByText('All', { exact: true }).click();
  await expect(page).toHaveURL(/range=All/);
});

test('command palette (Ctrl+K) navigates to a metro', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-360', 'desktop interaction');
  await gotoView(page, '/');
  await expect(page.getByLabel('Key national figures')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('pittsb');
  await expect(dialog.getByRole('option', { name: /Pittsburgh, PA/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/metro\/pittsburgh-pa/);
  await expect(page.getByRole('heading', { level: 1, name: /Pittsburgh/ })).toBeVisible();
});

test('old links land on their v2 homes: /metros → the atlas table, /dossier → /metro', async ({ page }) => {
  await gotoView(page, '/metros');
  await expect(page).toHaveURL(/#\/explore\?view=table/);
  const table = page.getByTestId('atlas-table');
  await expect(table.locator('tbody tr')).toHaveCount(50);
  // Sortable, and a metro opens from the table.
  await table.getByRole('button', { name: /^Metro/ }).click();
  await expect(table.getByRole('columnheader', { name: /Metro/ })).toHaveAttribute('aria-sort', 'ascending');
  await table.getByRole('button', { name: 'Anaheim, CA' }).click();
  await expect(page).toHaveURL(/sel=anaheim-ca/);
  await gotoView(page, '/dossier/denver-co?range=1Y');
  await expect(page).toHaveURL(/#\/metro\/denver-co\?range=1Y/);
  await gotoView(page, '/arrival');
  await expect(page).toHaveURL(/#\/$/);
});

test('metro dossier: rate strip, U.S. comparison, calculator', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, `/metro/${investigated}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('30-yr rate', { exact: true }).first()).toBeVisible();
  await page.getByText('Index to U.S.').click();
  await expect(page).toHaveURL(/vs=1/);
  await expect(page.getByText(/rebased to 100/)).toBeVisible();
  await page.getByRole('button', { name: 'Try your own numbers' }).click();
  const calc = page.getByRole('form', { name: 'Mortgage payment calculator' });
  await calc.scrollIntoViewIfNeeded();
  const before = await calc.getByRole('status').textContent();
  await calc.getByRole('spinbutton', { name: /Down payment/ }).fill('50');
  await expect(calc.getByRole('status')).not.toHaveText(before ?? '');
  await calc.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(calc.getByRole('status')).toHaveText(before ?? '');
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
  await gotoView(page, '/compare?m=pittsburgh-pa,houston-tx');
  await ready(page, /Compare metros/);
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/#\/compare\?/);
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
});

test('unknown metro shows not found', async ({ page }) => {
  await gotoView(page, '/metro/nowhere-zz');
  await expect(page.getByText('We don’t track a metro at that address.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse the atlas' })).toBeVisible();
});

test("data URLs carry this build's data version; the atlas fetches no metro files up front", async ({ page }) => {
  const dataRequests: string[] = [];
  page.on('request', (r) => r.url().includes('/data/') && dataRequests.push(r.url()));
  await gotoView(page, '/explore');
  await expect(page.locator('[data-atlas-mode]')).toBeAttached({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  expect(dataRequests.length).toBeGreaterThan(0);
  const versions = new Set(dataRequests.map((u) => new URL(u).searchParams.get('v')));
  expect(versions.size).toBe(1);
  expect([...versions][0]).toMatch(/^[0-9a-f]{12}$/);
  // Hover cards draw from metros[].spark; history loads only on the first scrub.
  expect(dataRequests.filter((u) => u.includes('/data/metros/') || u.includes('/data/timeline/'))).toEqual([]);
});

test.describe('mobile (360px)', () => {
  test.beforeEach(({ browserName }, info) => {
    void browserName; // Playwright requires a destructured fixture argument
    test.skip(info.project.name !== 'mobile-360', 'phone layout');
  });

  test('the search button opens the command palette by tap', async ({ page }) => {
    await gotoView(page, '/');
    await expect(page.getByLabel('Key national figures')).toBeVisible();
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await search.tap().catch(async () => search.click());
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('boston');
    await dialog.getByRole('option', { name: /Boston, MA/ }).first().click();
    await expect(page).toHaveURL(/#\/metro\/boston-ma/);
  });

  test('the dossier calculator fits and works at 360px', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, `/metro/${investigated}?section=affordability`);
    const reset = page.getByRole('button', { name: 'Reset to defaults' });
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeVisible();
    await reset.click();
    await expectNoHorizontalScroll(page);
  });
});
