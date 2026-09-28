/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at /real-estate-agent/; override with DASHBOARD_BASE
// (e.g. "/" for a custom domain). Data files live in public/data and are fetched
// relative to this base at runtime.
export default defineConfig({
  base: process.env.DASHBOARD_BASE ?? '/real-estate-agent/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          map: ['leaflet', 'react-leaflet'],
          vendor: ['react', 'react-dom', 'react-router-dom', 'zod'],
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
