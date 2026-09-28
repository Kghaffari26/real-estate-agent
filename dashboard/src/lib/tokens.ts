/**
 * JS access to design tokens for libraries that take color strings (Recharts, Leaflet).
 * They resolve through CSS variables, so the light/dark switch and a restyle in
 * tokens.css apply without touching any chart or map code.
 */
export type ColorToken =
  | 'text'
  | 'text-muted'
  | 'surface'
  | 'border'
  | 'accent'
  | 'positive'
  | 'negative'
  | 'neutral'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-grid'
  | 'chart-axis'
  | 'scale-neg-strong'
  | 'scale-neg'
  | 'scale-zero'
  | 'scale-pos'
  | 'scale-pos-strong'
  | 'scale-missing'
  | 'temp-cold'
  | 'temp-cool'
  | 'temp-balanced'
  | 'temp-warm'
  | 'temp-hot';

export function color(token: ColorToken, alpha?: number): string {
  return alpha === undefined ? `rgb(var(--color-${token}))` : `rgb(var(--color-${token}) / ${alpha})`;
}

/** Categorical series colors, in order. */
export const SERIES_COLORS: readonly ColorToken[] = ['chart-1', 'chart-2', 'chart-3', 'chart-4'];
