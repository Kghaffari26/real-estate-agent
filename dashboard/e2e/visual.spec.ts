/**
 * Visual regression (spec §12): every route in both themes at 390, 1024 and 1440 px,
 * plus the forced low tier, compared with local baselines at a small diff threshold.
 * Opt-in (VISUAL=1): baselines live in e2e/__visual__/ (gitignored) because WebGL and
 * font rendering differ by OS and GPU; regenerate them with `npm run visual:update`
 * after an intended change, and review the diffs by eye at each design gate.
 */
import { expect, gotoView, revealAll, test } from './fixtures';

const ROUTES = [
  { name: 'arrival', path: '/' },
  { name: 'explore', path: '/explore' },
  { name: 'dossier', path: '/metro/austin-tx' },
  { name: 'studio', path: '/metro/austin-tx/afford' },
  { name: 'compare', path: '/compare?m=oakland-ca,denver-co,austin-tx&metrics=median_sale_price,inventory' },
  { name: 'methodology', path: '/methodology' },
];
const WIDTHS = [390, 1024, 1440];

test.describe('visual regression', () => {
  test.skip(!process.env.VISUAL, 'set VISUAL=1 (npm run visual)');
  test.setTimeout(60_000);

  for (const route of ROUTES) {
    for (const theme of ['dark', 'light'] as const) {
      for (const width of WIDTHS) {
        test(`${route.name} ${theme} ${width}`, async ({ page, consoleErrors }, info) => {
          void consoleErrors; // installs the offline basemap stand-in
          test.skip(info.project.name !== 'desktop', 'one project renders every width');
          await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await gotoView(page, route.path);
          await page.waitForLoadState('networkidle');
          await revealAll(page);
          await page.waitForTimeout(1500);
          await expect(page).toHaveScreenshot(`${route.name}-${theme}-${width}.png`, { maxDiffPixelRatio: 0.02, animations: 'disabled' });
        });
      }
    }
    test(`${route.name} low tier`, async ({ page, consoleErrors }, info) => {
      void consoleErrors;
      test.skip(info.project.name !== 'desktop', 'one project');
      await page.addInitScript(() => localStorage.setItem('re-theme', 'dark'));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await gotoView(page, `${route.path}${route.path.includes('?') ? '&' : '?'}tier=low`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`${route.name}-low-1440.png`, { maxDiffPixelRatio: 0.02, animations: 'disabled' });
    });
  }
});
