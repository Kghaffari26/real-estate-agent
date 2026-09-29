/**
 * The affordability studio (spec §7.4, §12): the default payment is the published
 * one, sliders drive the payment text (checked against the agent's formula), the URL
 * holds the inputs, "Reset to published" restores them, the low tier shows the 2.5D
 * house, and axe is clean in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundCents } from '../src/lib/amortization';
import { studio } from '../src/lib/studio';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const austin = JSON.parse(readFileSync(resolve(root, 'sample-data/metros/austin-tx.json'), 'utf8'));
const cents = (v: number) => `$${roundCents(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const published = { price: austin.latest.median_sale_price.value, downPaymentPct: austin.affordability.assumptions.down_payment_pct * 100, ratePct: austin.affordability.assumptions.rate_now, termYears: austin.affordability.assumptions.term_years };
const pay = (over: Partial<typeof published>) => cents(studio({ ...published, ...over }, null, null).payment!);
const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`studio renders, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, '/metro/austin-tx/afford');
    await expect(page.getByRole('heading', { level: 1, name: /What a home costs in Austin/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
    expect(serious(results.violations)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('the default payment is the published payment; income is honestly missing', async ({ page }) => {
  await gotoView(page, '/metro/austin-tx/afford');
  await expect(page.getByTestId('studio-payment')).toHaveText(cents(austin.affordability.payment_now));
  await expect(page.getByText(/Needs income data/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset to published' })).toBeDisabled();
});

test('sliders drive the payment; the URL holds the inputs; reset restores them', async ({ page }) => {
  await gotoView(page, '/metro/austin-tx/afford');
  const rate = page.getByRole('slider', { name: '30-yr rate' });
  await rate.focus();
  await page.keyboard.press('Home'); // 2.00%
  await expect(page).toHaveURL(/[?&]rate=2\.00/);
  await expect(page.getByTestId('studio-payment')).toHaveText(pay({ ratePct: 2 }));
  await page.getByText('15 yr', { exact: true }).click();
  await expect(page).toHaveURL(/[?&]term=15/);
  await expect(page.getByTestId('studio-payment')).toHaveText(pay({ ratePct: 2, termYears: 15 }));
  await expect(page.getByTestId('stack-legend')).toContainText('Interest over 15 years');
  await page.getByRole('button', { name: 'Reset to published' }).click();
  await expect(page).not.toHaveURL(/rate=|term=/);
  await expect(page.getByTestId('studio-payment')).toHaveText(cents(austin.affordability.payment_now));
});

test('a shared link reproduces its numbers', async ({ page }) => {
  await gotoView(page, '/metro/austin-tx/afford?price=650000&rate=5.50&term=15&down=10');
  await expect(page.getByTestId('studio-payment')).toHaveText(pay({ price: 650000, ratePct: 5.5, termYears: 15, downPaymentPct: 10 }));
  await expect(page.getByTestId('house-caption')).toContainText('House 1.60×'); // clamped
});

test('the dossier opens the studio; the low tier shows the 2.5D house', async ({ page }) => {
  await gotoView(page, '/metro/austin-tx');
  await page.getByTestId('open-studio').click();
  await expect(page).toHaveURL(/#\/metro\/austin-tx\/afford/);
  await gotoView(page, '/metro/austin-tx/afford?tier=low');
  await expect(page.locator('[data-house-mode="2d"]')).toBeAttached();
  await expect(page.locator('[data-house-mode] canvas')).toHaveCount(0);
});
