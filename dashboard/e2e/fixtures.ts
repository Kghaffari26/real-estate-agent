import { test as base, expect, type Page } from '@playwright/test';

/** Every test: map tiles stubbed (no third-party network), console errors collected. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) }));
    await use(errors);
  },
});

export { expect };

/** Views are hash-routed: /real-estate-agent/#/metros */
export async function gotoView(page: Page, hashPath: string) {
  await page.goto(`./#${hashPath}`);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
}
