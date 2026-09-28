/** Tailwind theme: every value maps to a CSS variable in src/styles/tokens.css. */
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

const colorNames = [
  'bg', 'surface', 'surface-muted', 'border', 'text', 'text-muted', 'accent', 'accent-contrast', 'focus',
  'positive', 'negative', 'neutral', 'warning', 'info',
  'severity-info', 'severity-notable', 'severity-major',
  'temp-cold', 'temp-cool', 'temp-balanced', 'temp-warm', 'temp-hot',
  'chart-1', 'chart-2', 'chart-3', 'chart-4',
];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: Object.fromEntries(colorNames.map((name) => [name, token(name)])),
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};
