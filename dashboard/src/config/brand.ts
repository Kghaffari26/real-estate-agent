/**
 * The product's identity, in one place. Rebrand = edit this file, the mark
 * (`AtlasMark` in src/ui/CommandBar.tsx), and the accent tokens (`--mp-accent*` in
 * src/styles/atlas.css), then `npm run brand-assets` for the favicon and OG image.
 * vite.config.ts injects these values into index.html (title, description, OG tags).
 */
export const BRAND = {
  name: 'Metro Pulse',
  tagline: 'U.S. housing market intelligence',
  description:
    'Metro Pulse tracks the U.S. housing market nationally and across the 50 largest metros: prices, inventory, speed, rents and mortgage rates, with AI-written analyst notes checked against the numbers.',
  /** Public URL of the deployed site (for absolute OG image links). */
  siteUrl: 'https://kghaffari26.github.io/real-estate-agent/',
  /** Shown in the print one-pager footer and the About page. */
  publisher: 'Metro Pulse',
  themeColor: { light: '#ffffff', dark: '#111214' },
} as const;
