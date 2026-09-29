/**
 * Quality tiers (spec §9): `?tier=` forces a tier; medium keeps 3D without terrain,
 * low swaps in the designed 2D atlas without 3D-only controls, and a save-data
 * connection keeps Arrival's globe poster instead of loading the WebGL globe.
 */
import { expect, gotoView, test } from './fixtures';

test('high offers terrain; medium keeps 3D without it; low is 2D without 3D buildings', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the layer dock is a sheet on phones');
  await gotoView(page, '/explore?tier=high');
  await expect(page.locator('[data-atlas-mode="3d"]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByRole('switch', { name: /Terrain/ })).toBeVisible();
  await gotoView(page, '/explore?tier=medium');
  await expect(page.locator('[data-atlas-mode="3d"]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByRole('switch', { name: /Terrain/ })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: /3D buildings/ })).toBeVisible();
  await gotoView(page, '/explore?tier=low');
  await expect(page.locator('[data-atlas-mode="2d"]')).toBeAttached({ timeout: 20_000 });
  await expect(page.getByRole('switch', { name: /3D buildings/ })).toHaveCount(0);
});

test('save-data keeps the globe poster (no WebGL globe)', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  await gotoView(page, '/');
  await expect(page.getByRole('heading', { name: 'What the numbers say' })).toBeAttached();
  await page.waitForTimeout(2500);
  await expect(page.locator('section[aria-label="Overview"] img[src*="arrival-globe"]')).toBeVisible();
  await expect(page.locator('section[aria-label="Overview"] canvas')).toHaveCount(0);
});

test('the pre-JS poster is gone once the app has painted, and never shows off Arrival', async ({ page }) => {
  await gotoView(page, '/');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 15_000 });
  await gotoView(page, '/methodology');
  await expect(page.locator('#boot')).toHaveCount(0);
});
