/**
 * Arrival (spec §7.1): the hero's figures are the index's, the globe renders (or its
 * poster shows), the sections carry the published numbers, "Enter the market" lands
 * on the atlas, and axe finds nothing serious in either theme.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDelta, formatMonth, formatValue } from '../src/lib/format';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(resolve(root, 'sample-data/latest.json'), 'utf8'));

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`arrival renders, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, '/arrival');
    await expect(page.getByText(index.headline)).toBeVisible();
    await expect(page.getByTestId('globe-canvas')).toBeAttached({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    // Every section is on the page (reduced motion: no reveal delays).
    for (const h of ['What the numbers say', 'Fifty markets, one field', 'The cost of money, the price of a home', 'Who moved most', 'The investigations']) {
      await expect(page.getByRole('heading', { name: h })).toBeAttached();
    }
    const results = await new AxeBuilder({ page }).exclude('[data-testid="globe-canvas"]').analyze();
    expect(serious(results.violations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('hero figures are the published key stats', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/arrival');
  const figures = page.getByRole('definition');
  const price = index.key_stats.find((k: { format: string }) => k.format === 'currency_compact' || k.format === 'currency');
  const rate = index.key_stats.find((k: { format: string }) => k.format === 'percent');
  await expect(page.getByLabel('Key national figures')).toContainText(formatValue(price.value, 'currency'));
  await expect(page.getByLabel('Key national figures')).toContainText(formatValue(rate.value, 'percent', { scale: 'points' }));
  await expect(page.getByLabel('Key national figures')).toContainText(formatDelta(index.national.latest.inventory.yoy, 'percent_signed'));
  expect(await figures.count()).toBeGreaterThanOrEqual(6);
});

test('heat field re-ranks and links every bar to the atlas', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/arrival');
  const field = page.getByRole('group', { name: /50 metros ranked by temperature/ });
  const bars = field.getByRole('link');
  await expect(bars).toHaveCount(50);
  const hottest = [...index.metros].sort((a, b) => (b.temperature.score ?? -1) - (a.temperature.score ?? -1) || a.name.localeCompare(b.name))[0];
  await expect(bars.first()).toHaveAttribute('href', new RegExp(`sel=${hottest.slug}$`));
  await page.getByText('Price YoY', { exact: true }).click();
  const topGain = [...index.metros].sort((a, b) => (b.latest.median_sale_price.yoy ?? -1) - (a.latest.median_sale_price.yoy ?? -1))[0];
  await expect(page.getByRole('group', { name: /50 metros ranked by price yoy/i }).getByRole('link').first()).toHaveAttribute('aria-label', `${topGain.name}: Price YoY ${formatDelta(topGain.latest.median_sale_price.yoy, 'percent_signed')}`);
});

test('rates vs prices reads the latest published values', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/arrival');
  const nat = index.national;
  const section = page.locator('#rates');
  await expect(section).toContainText(formatValue(nat.rates.mortgage30.at(-1), 'percent', { scale: 'points' }));
  await expect(section).toContainText(formatValue(nat.series.median_sale_price.at(-1), 'currency_compact'));
  await expect(section).toContainText(formatMonth(nat.series.dates.at(-1), true));
});

test('Enter the market lands on the atlas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/arrival');
  await page.getByTestId('enter-market').click();
  await expect(page).toHaveURL(/#\/explore/);
  await expect(page.locator('[data-atlas-mode]')).toBeAttached({ timeout: 20_000 });
});
