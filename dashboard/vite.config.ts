/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { BRAND } from './src/config/brand';
// @ts-expect-error: plain .mjs build script without types
import { dataVersion } from './scripts/data-version.mjs';
// @ts-expect-error: plain .mjs build script without types
import { checkDeskConfig } from './scripts/secret-scan.mjs';

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

/**
 * The Desk's backend config (R3) as `desk-config.json`, from SUPABASE_URL and
 * SUPABASE_ANON_KEY at build time (GitHub secrets in CI). The anon key is public by
 * design; row-level security protects the data. Without both, no file: the Desk says
 * it isn't configured and the rest of the site is unchanged. Never the service-role key:
 * the build throws if it sees one, and scripts/check-secrets.mjs scans dist/ after it.
 */
function deskConfig(): Plugin {
  const url = process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const body = url && anonKey ? JSON.stringify({ url, anonKey }) : null;
  // Refuse to build (or serve) a config that isn't exactly a public URL + anon key, so a
  // service-role key pasted into the wrong secret never reaches the site.
  const problems: string[] = body ? checkDeskConfig({ url, anonKey }) : [];
  if (problems.length) throw new Error(`desk-config.json refused: ${problems.join('; ')}. Set SUPABASE_ANON_KEY to the project's anon (publishable) key.`);
  return {
    name: 'desk-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.endsWith('/desk-config.json')) return next();
        if (!body) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      });
    },
    generateBundle() {
      if (body) this.emitFile({ type: 'asset', fileName: 'desk-config.json', source: body });
    },
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
  plugins: [react(), brandHtml(), preloadIndex(BASE, DATA_VERSION), deskConfig()],
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
