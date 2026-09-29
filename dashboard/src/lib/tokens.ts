/**
 * JS access to design tokens for libraries that take color strings (SVG
 * charts, MapLibre, canvas export). `color()` returns a CSS expression that follows the
 * theme automatically; `resolveColor()` reads the current computed value for
 * libraries that can't evaluate CSS variables (MapLibre paint, PNG export).
 */
export type ColorToken =
  | 'bg' | 'surface' | 'surface-2' | 'surface-3' | 'border' | 'border-strong'
  | 'text' | 'text-2' | 'text-3' | 'accent' | 'accent-soft'
  | 'good' | 'good-text' | 'warning' | 'warning-text' | 'bad' | 'bad-text'
  | 'cat-1' | 'cat-2' | 'cat-3' | 'cat-4'
  | 'div-neg-3' | 'div-neg-2' | 'div-neg-1' | 'div-mid' | 'div-pos-1' | 'div-pos-2' | 'div-pos-3' | 'div-missing'
  | 'seq-1' | 'seq-2' | 'seq-3' | 'seq-4' | 'seq-5' | 'seq-6'
  | 'grid' | 'axis' | 'crosshair';

export function color(token: ColorToken, alpha?: number): string {
  return alpha === undefined ? `rgb(var(--color-${token}))` : `rgb(var(--color-${token}) / ${alpha})`;
}

/** The token's current value as `rgb(r, g, b)` (or rgba), read from the document. */
export function resolveColor(token: ColorToken, alpha = 1, el: Element = document.documentElement): string {
  const raw = getComputedStyle(el).getPropertyValue(`--color-${token}`).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return alpha === 1 ? '#888888' : `rgba(136, 136, 136, ${alpha})`;
  const [r, g, b] = parts;
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Categorical slots in their validated order (dataviz validator: adjacent pairs pass
 * in both modes; slots 1–3 pass all-pairs, which is why Compare caps at 3 metros).
 */
export const CATEGORICAL: readonly ColorToken[] = ['cat-1', 'cat-2', 'cat-3', 'cat-4'];

/** Diverging steps, most negative → most positive (7 steps, gray midpoint). */
export const DIVERGING: readonly ColorToken[] = ['div-neg-3', 'div-neg-2', 'div-neg-1', 'div-mid', 'div-pos-1', 'div-pos-2', 'div-pos-3'];

/** Sequential one-hue ramp, low → high. */
export const SEQUENTIAL: readonly ColorToken[] = ['seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5', 'seq-6'];
