/**
 * Tailwind theme: every color, font, radius and shadow maps to a CSS variable in
 * src/styles/tokens.css. The type scale and spacing (4/8px) are defined here.
 */
const c = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
const colors = [
  'bg', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-2', 'text-3',
  'accent', 'accent-hover', 'accent-soft', 'accent-contrast', 'focus',
  'good', 'good-text', 'warning', 'warning-text', 'bad', 'bad-text', 'info-text',
  'cat-1', 'cat-2', 'cat-3', 'cat-4',
  'div-neg-3', 'div-neg-2', 'div-neg-1', 'div-mid', 'div-pos-1', 'div-pos-2', 'div-pos-3', 'div-missing',
  'seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5', 'seq-6', 'grid', 'axis', 'crosshair',
];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: Object.fromEntries(colors.map((n) => [n, c(n)])),
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
      // Type scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 / 40
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.01em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        xl: ['24px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
        '2xl': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        '3xl': ['40px', { lineHeight: '48px', letterSpacing: '-0.025em' }],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
      boxShadow: { 1: 'var(--shadow-1)', 2: 'var(--shadow-2)', 3: 'var(--shadow-3)' },
      spacing: { 'sidebar': 'var(--sidebar-w)', 'sidebar-c': 'var(--sidebar-w-collapsed)', header: 'var(--header-h)' },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      transitionDuration: { 1: 'var(--dur-1)', 2: 'var(--dur-2)', 3: 'var(--dur-3)' },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
};
