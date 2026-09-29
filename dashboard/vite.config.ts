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

// GitHub Pages serves the site at /real-estate-agent/; override with DASHBOARD_BASE.
export default defineConfig({
  base: process.env.DASHBOARD_BASE ?? '/real-estate-agent/',
  // Cache-busts every data URL per dataset (see scripts/data-version.mjs); prebuild's
  // fetch-data has already filled public/data when this runs.
  define: { __DATA_VERSION__: JSON.stringify(dataVersion(fileURLToPath(new URL('./public/data', import.meta.url)))) },
  plugins: [react(), brandHtml()],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'map';
          // d3-geo serves the atlas (rings, the 2D fallback), not the charts: keep Recharts out of /explore.
          if (/node_modules[\\/]d3-(geo|array)[\\/]/.test(id)) return 'geo';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor')) return 'charts';
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
