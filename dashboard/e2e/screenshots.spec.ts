/**
 * Regenerates docs/screenshots/*.png (README "Dashboard" section).
 * Run with `npm run screenshots`; skipped in the normal e2e run.
 * Map tiles are stubbed (this keeps runs offline-safe), so the map shows markers only.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, gotoView, test } from './fixtures';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');

const SHOTS: Array<{ file: string; path: string; heading: RegExp; theme?: 'dark'; mobile?: boolean }> = [
  { file: 'overview.png', path: '/', heading: /U\.S\. housing market/ },
  { file: 'metros.png', path: '/metros', heading: /^Metros$/ },
  { file: 'metro-detail.png', path: '/metro/pittsburgh-pa?rate=1', heading: /Pittsburgh, PA/ },
  { file: 'compare.png', path: '/compare?m=pittsburgh-pa,houston-tx,boston-ma&metrics=median_sale_price,inventory&indexed=1', heading: /Compare metros/ },
  { file: 'about.png', path: '/about', heading: /About and methodology/ },
  { file: 'overview-dark.png', path: '/', heading: /U\.S\. housing market/, theme: 'dark' },
  { file: 'metro-detail-mobile.png', path: '/metro/pittsburgh-pa', heading: /Pittsburgh, PA/, mobile: true },
];

test.describe('screenshots', () => {
  test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (npm run screenshots)');

  for (const shot of SHOTS) {
    test(shot.file, async ({ page }, info) => {
      test.skip(info.project.name !== (shot.mobile ? 'mobile-360' : 'desktop'));
      if (shot.theme) await page.addInitScript(() => localStorage.setItem('re-theme', 'dark'));
      if (!shot.mobile) await page.setViewportSize({ width: 1280, height: 900 });
      await gotoView(page, shot.path);
      await expect(page.getByRole('heading', { level: 1, name: shot.heading })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: resolve(OUT, shot.file), fullPage: true });
    });
  }
});
