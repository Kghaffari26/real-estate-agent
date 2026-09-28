/**
 * Regenerates docs/screenshots/*.png (README "Dashboard" section): every view in
 * light and dark at 1440px, plus 390px mobile. Run with `npm run screenshots`.
 * The basemap is the offline stand-in from fixtures.ts (OpenFreeMap is unreachable
 * where screenshots are taken); the live site uses OpenFreeMap tiles.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, gotoView, revealAll, test } from './fixtures';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');

const VIEWS: Array<{ name: string; path: string; heading: RegExp }> = [
  { name: 'overview', path: '/', heading: /./ },
  { name: 'metros', path: '/metros', heading: /^Metros$/ },
  { name: 'metro-detail', path: '/metro/west-palm-beach-fl', heading: /West Palm Beach, FL/ },
  { name: 'compare', path: '/compare?m=pittsburgh-pa,houston-tx,boston-ma&metrics=median_sale_price,inventory&indexed=1', heading: /Compare metros/ },
  { name: 'about', path: '/about', heading: /Methodology/ },
];

const MODES = [
  { suffix: '', theme: 'light', width: 1440, project: 'desktop' },
  { suffix: '-dark', theme: 'dark', width: 1440, project: 'desktop' },
  { suffix: '-mobile', theme: 'light', width: 390, project: 'mobile-360' },
] as const;

test.describe('screenshots', () => {
  test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (npm run screenshots)');
  test.setTimeout(60_000);

  for (const view of VIEWS) {
    for (const mode of MODES) {
      test(`${view.name}${mode.suffix}`, async ({ page, consoleErrors }, info) => {
        void consoleErrors; // installs the basemap stand-in
        test.skip(info.project.name !== mode.project);
        await page.addInitScript((t) => localStorage.setItem('re-theme', t), mode.theme);
        await page.setViewportSize({ width: mode.width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await gotoView(page, view.path);
        await expect(page.getByRole('heading', { level: 1, name: view.heading }).first()).toBeVisible();
        await revealAll(page);
        await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1200); // map tiles/bubbles and chart layout settle
        await page.screenshot({ path: resolve(OUT, `${view.name}${mode.suffix}.png`), fullPage: true });
      });
    }
  }
});
