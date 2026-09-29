import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// Cloud dev containers ship Chromium at a fixed path; CI uses `npx playwright install`.
// PW_CHROMIUM points at any local Chromium build (e.g. a newer one on a dev machine).
const localChromium = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  // Visual baselines (e2e/visual.spec.ts, VISUAL=1) stay local: rendering differs by OS/GPU.
  snapshotPathTemplate: '{testDir}/__visual__/{arg}{ext}',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/real-estate-agent/`,
    trace: 'retain-on-failure',
    // Software WebGL so MapLibre renders in headless runs.
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      ...(existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {}),
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 }, isMobile: false, hasTouch: true } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/real-estate-agent/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
