/**
 * Quality tiers (spec §9): what the device gets.
 *
 * - **high**: 3D everywhere, terrain available, 3D buildings from zoom 12, DPR ≤ 2.
 * - **medium**: 3D, no terrain, buildings from zoom 13, DPR ≤ 1.5.
 * - **low** (or no WebGL2): the designed 2D atlas, the globe poster, the isometric
 *   SVG houses.
 *
 * Reduced motion keeps the tier's visuals but stops every decorative animation
 * (`qualitySettings(tier, { reducedMotion })`); the spec's "medium minus animation" is
 * applied by capping high at medium.
 *
 * Detection is pure and runs on hints read once from the browser (no benchmark
 * download: detect-gpu fetches its tables from a CDN on every visit, a third-party
 * request the site otherwise never makes). `?tier=low|medium|high` overrides it,
 * which is how tests and screenshots force a tier.
 */
export type Tier = 'high' | 'medium' | 'low';

export interface DeviceHints {
  webgl: boolean;
  webgl2: boolean;
  /** UNMASKED_RENDERER_WEBGL when the browser exposes it. */
  renderer: string | null;
  /** navigator.deviceMemory (GB), when exposed. */
  memoryGb?: number | null;
  /** navigator.hardwareConcurrency. */
  cores?: number | null;
  /** A coarse pointer and a small screen. */
  mobile: boolean;
  /** navigator.connection.saveData. */
  saveData?: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;

export function detectTier(h: DeviceHints): Tier {
  if (!h.webgl || !h.webgl2) return 'low';
  if ((h.memoryGb != null && h.memoryGb < 2) || (h.cores != null && h.cores < 2)) return 'low';
  // Software GL renders 3D correctly, just slowly: keep 3D, drop the heavy extras.
  if (h.renderer && SOFTWARE.test(h.renderer)) return 'medium';
  if (h.mobile || h.saveData || (h.memoryGb != null && h.memoryGb <= 4) || (h.cores != null && h.cores <= 4)) return 'medium';
  return 'high';
}

export function parseTier(raw: string | null | undefined): Tier | null {
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : null;
}

export interface QualitySettings {
  tier: Tier;
  /** WebGL surfaces (map, globe, houses); false = the 2D designs. */
  webgl: boolean;
  /** Max device pixel ratio for canvases. */
  dpr: number;
  terrain: boolean;
  buildingsMinZoom: number;
  /** Decorative motion (globe spin, arena orbit, ticker drift, ambience). */
  animate: boolean;
  /** Start heavy decorative media on load (not on saveData connections). */
  autoplay: boolean;
  /** The connection asked to save data: keep posters, skip decorative WebGL. */
  saveData: boolean;
}

export function qualitySettings(tier: Tier, opts: { reducedMotion?: boolean; saveData?: boolean } = {}): QualitySettings {
  const t: Tier = opts.reducedMotion && tier === 'high' ? 'medium' : tier;
  return {
    tier: t,
    webgl: t !== 'low',
    dpr: t === 'high' ? 2 : t === 'medium' ? 1.5 : 1,
    terrain: t === 'high',
    buildingsMinZoom: t === 'high' ? 12 : 13,
    animate: !opts.reducedMotion,
    autoplay: !opts.reducedMotion && !opts.saveData,
    saveData: Boolean(opts.saveData),
  };
}

// ---------- browser glue ----------

let detected: { tier: Tier; saveData: boolean } | undefined;

function readHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  let webgl = false;
  let webgl2 = false;
  let renderer: string | null = null;
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 ?? canvas.getContext('webgl');
    webgl = Boolean(gl);
    webgl2 = Boolean(gl2);
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    renderer = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // no WebGL
  }
  const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768;
  return { webgl, webgl2, renderer, memoryGb: nav.deviceMemory ?? null, cores: nav.hardwareConcurrency ?? null, mobile, saveData: Boolean(nav.connection?.saveData) };
}

/** The tier for this page load: `?tier=` in the hash query, else detected once. */
export function currentTier(hashSearch: string = window.location.hash.split('?')[1] ?? ''): { tier: Tier; saveData: boolean } {
  const forced = parseTier(new URLSearchParams(hashSearch).get('tier'));
  if (!detected) {
    const hints = readHints();
    detected = { tier: detectTier(hints), saveData: Boolean(hints.saveData) };
  }
  return forced ? { tier: forced, saveData: detected.saveData } : detected;
}
