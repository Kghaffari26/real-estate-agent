/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { BRAND } from './src/config/brand';
// @ts-expect-error: plain .mjs build script without types
import { dataVersion } from './scripts/data-version.mjs';

/** Fills %BRAND_*% placeholders in index.html from the single brand config. */
function brandHtml(): Plugin {
  const values: Record<string, string> = {
    BRAND_NAME: BRAND.name,
    BRAND_TAGLINE: BRAND.tagline,
    BRAND_DESCRIPTION: BRAND.description,
    BRAND_URL: BRAND.siteUrl,
    BRAND_THEME_LIGHT: BRAND.themeColor.light,
    BRAND_THEME_DARK: BRAND.themeColor.dark,
  };
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return {
    name: 'brand-html',
    transformIndexHtml: (html) => html.replace(/%(BRAND_[A-Z_]+)%/g, (m, key: string) => (key in values ? escape(values[key]!) : m)),
  };
}

/** Preloads the index (every route's first request) alongside the app code (spec §9: LCP). */
function preloadIndex(base: string, version: string): Plugin {
  return {
    name: 'preload-index',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'preload', href: `${base}data/latest.json?v=${encodeURIComponent(version)}`, as: 'fetch', crossorigin: 'anonymous' }, injectTo: 'head' },
    ],
  };
}

// GitHub Pages serves the site at /real-estate-agent/; override with DASHBOARD_BASE.
const BASE = process.env.DASHBOARD_BASE ?? '/real-estate-agent/';
// Cache-busts every data URL per dataset (see scripts/data-version.mjs); prebuild's
// fetch-data has already filled public/data when this runs.
const DATA_VERSION = dataVersion(fileURLToPath(new URL('./public/data', import.meta.url)));

export default defineConfig({
  base: BASE,
  define: { __DATA_VERSION__: JSON.stringify(DATA_VERSION) },
  plugins: [react(), brandHtml(), preloadIndex(BASE, DATA_VERSION)],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'map';
          // d3-geo serves the atlas (rings, the 2D fallback) and the globe.
          if (/node_modules[\\/]d3-(geo|array)[\\/]/.test(id)) return 'geo';
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|zod)\//.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    css: false,
  },
});
