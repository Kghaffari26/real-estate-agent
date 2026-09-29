/**
 * Cross-app smoke checks. The v2 screens (Arrival, Atlas, Dossier, Styleguide) have
 * their own specs (arrival, explore, dossier, v2) with axe in both themes; this file
 * covers the v1-shell pages that remain (Compare, Methodology), the flows that span
 * screens (⌘K, redirects of old links, data versioning) and the phone layout.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

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

test('metro dossier: rate strip, U.S. comparison, the way into the studio', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, `/metro/${investigated}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('30-yr rate', { exact: true }).first()).toBeVisible();
  await page.getByText('Index to U.S.').click();
  await expect(page).toHaveURL(/vs=1/);
  await expect(page.getByText(/rebased to 100/)).toBeVisible();
  // The calculator lives in the affordability studio (studio.spec covers its numbers).
  await page.getByTestId('open-studio').click();
  await expect(page).toHaveURL(new RegExp(`#/metro/${investigated}/afford`));
  const rate = page.getByRole('slider', { name: '30-yr rate' });
  const before = await page.getByTestId('studio-payment').textContent();
  await rate.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('studio-payment')).not.toHaveText(before ?? '');
  await page.getByRole('button', { name: 'Reset to published' }).click();
  await expect(page.getByTestId('studio-payment')).toHaveText(before ?? '');
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

  test('the affordability studio fits and works at 360px', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, `/metro/${investigated}/afford`);
    const reset = page.getByRole('button', { name: 'Reset to published' });
    await page.getByText('15 yr', { exact: true }).click();
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(reset).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });
});
