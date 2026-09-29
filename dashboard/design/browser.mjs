// Launch the newest local Chromium for design captures (Playwright's own browser in CI).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function localChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const dir = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
  if (!dir || !existsSync(dir)) return undefined;
  const c = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  return c ? [join(dir, c, 'chrome-win64', 'chrome.exe'), join(dir, c, 'chrome-win', 'chrome.exe')].find(existsSync) : undefined;
}

/** gpu: use the machine's GPU (smooth video); otherwise software WebGL (deterministic stills). */
export function launch({ gpu = false } = {}) {
  const args = gpu ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  return chromium.launch({ executablePath: localChromium(), args });
}

export const BASE = process.env.ATLAS_BASE ?? 'http://localhost:4173/real-estate-agent/#/explore';

/** Resolves once the live MapLibre map (exposed on its container) has loaded. */
export async function mapLoaded(page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('div')).some((d) => d.__map?.loaded()), undefined, { timeout: 30_000 });
}

export function projector(page) {
  return (lon, lat) =>
    page.evaluate(([x, y]) => {
      const el = Array.from(document.querySelectorAll('div')).find((d) => d.__map);
      const q = el.__map.project([x, y]);
      return { x: q.x, y: q.y };
    }, [lon, lat]);
}
