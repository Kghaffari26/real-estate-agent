/**
 * Metro Pulse v2 ("Night Atlas") routes: axe in both themes, keyboard paths, and
 * with V2_SHOTS=1 the review screenshots in docs/screenshots/v2/ (1440, 1280, 390;
 * Night and Dawn).
 */
import AxeBuilder from '@axe-core/playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots/v2');

for (const theme of ['dark', 'light'] as const) {
  test(`styleguide: no serious axe issues (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoView(page, '/styleguide');
    await expect(page.getByRole('heading', { level: 1, name: 'Night Atlas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Time machine' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('styleguide: scrubber and radius slider work from the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoView(page, '/styleguide');
  const month = page.getByRole('slider', { name: 'Month' });
  await month.focus();
  await page.keyboard.press('Home');
  await expect(month).toHaveAttribute('aria-valuetext', /2023/);
  await page.keyboard.press('End');
  await expect(month).toHaveAttribute('aria-valuetext', /August 2026/);
  const radius = page.getByRole('slider', { name: 'Search radius' });
  await radius.focus();
  await page.keyboard.press('Home');
  await expect(radius).toHaveAttribute('aria-valuetext', '10 mi');
  await page.keyboard.press('End');
  await expect(radius).toHaveAttribute('aria-valuetext', '250 mi');
});

test.describe('v2 screenshots', () => {
  test.skip(!process.env.V2_SHOTS, 'set V2_SHOTS=1');
  test.setTimeout(90_000);
  const widths = [
    { name: 'desktop', width: 1440 },
    { name: 'laptop', width: 1280 },
    { name: 'mobile', width: 390 },
  ];
  for (const theme of ['dark', 'light'] as const) {
    for (const w of widths) {
      test(`styleguide ${w.name} ${theme}`, async ({ page }, info) => {
        test.skip(info.project.name !== 'desktop');
        await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
        await page.setViewportSize({ width: w.width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await gotoView(page, '/styleguide');
        await expect(page.getByRole('heading', { name: 'Motion' })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${OUT}/p2-styleguide-${w.name}-${theme === 'dark' ? 'night' : 'dawn'}.png`, fullPage: true });
      });
    }
  }
});
