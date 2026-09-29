/**
 * The v2 metro dossier (spec §7.3, §12): hero figures are the metro file's, the house
 * is sized and lit from published values (and summarized for screen readers), a
 * cited-metric chip switches the chart and highlights its instrument, "All" reaches
 * back to 2012, the low tier shows the 2.5D house, and axe is clean in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { houseScale } from '../src/lib/dossier';
import { formatMonth, formatValue } from '../src/lib/format';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(resolve(root, 'sample-data/latest.json'), 'utf8'));
const metro = (slug: string) => JSON.parse(readFileSync(resolve(root, `sample-data/metros/${slug}.json`), 'utf8'));
const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`dossier renders, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, '/dossier/austin-tx');
    await expect(page.getByRole('heading', { level: 1, name: /Austin/ })).toBeVisible();
    await expect(page.locator('[data-house-mode]')).toBeAttached();
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
    expect(serious(results.violations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

for (const slug of ['oakland-ca', 'denver-co', 'austin-tx']) {
  test(`${slug}: hero figures and the house come from the published data`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, `/dossier/${slug}`);
    const m = metro(slug);
    await expect(page.getByTestId('temperature')).toContainText(String(m.temperature.score));
    const stats = page.getByTestId('headline-stats');
    await expect(stats).toContainText(formatValue(m.latest.median_sale_price.value, 'currency'));
    await expect(stats).toContainText(formatValue(m.latest.inventory.value, 'count'));
    const scale = houseScale(m.latest.median_sale_price.value, index.national.latest.median_sale_price.value);
    await expect(page.getByTestId('house-summary')).toContainText(`sized ${scale.toFixed(2)} times`);
    await expect(page.getByTestId('house-summary')).toContainText(m.temperature.score < 50 ? 'cool blue' : 'warm amber');
    await expect(page.getByText(/Illustrative/)).toBeVisible();
  });
}

test('a cited-metric chip switches the chart and highlights its instrument', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/dossier/austin-tx');
  const m = metro('austin-tx');
  await page.getByTestId('cited-chips').getByRole('button', { name: 'Active inventory' }).click();
  await expect(page).toHaveURL(/[?&]m=inventory/);
  await expect(page.getByRole('heading', { level: 2, name: 'Active inventory' })).toBeVisible();
  await expect(page.getByTestId('chart-readout')).toHaveText(formatValue(m.latest.inventory.value, 'count'));
  await expect(page.locator('#instrument-inventory')).toHaveClass(/shadow-\[inset/);
});

test('"All" reaches back to 2012 through the published timeline', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop layout');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/dossier/austin-tx?range=All');
  const chart = page.getByRole('img', { name: /Median sale price for Austin, TX/ });
  await expect(chart).toHaveAttribute('aria-label', new RegExp(formatMonth('2012-01-31', true)));
  await chart.focus();
  await page.keyboard.press('Home');
  const tl = JSON.parse(readFileSync(resolve(root, 'sample-data/timeline/median_sale_price.json'), 'utf8'));
  await expect(page.getByTestId('chart-readout')).toHaveText(formatValue(tl.metros['austin-tx'][0], 'currency'));
});

test('low tier: the 2.5D house, no WebGL canvas', async ({ page }) => {
  await gotoView(page, '/dossier/oakland-ca?tier=low');
  await expect(page.locator('[data-house-mode="2d"]')).toBeAttached();
  await expect(page.locator('[data-house-mode] canvas')).toHaveCount(0);
});

test('Fly there opens the atlas on this metro', async ({ page }) => {
  await gotoView(page, '/dossier/denver-co');
  await page.getByTestId('fly-there').click();
  await expect(page).toHaveURL(/#\/explore\?sel=denver-co/);
});
