/** Feature check for the map (MapLibre needs WebGL). */
let cached: boolean | undefined;

/** Cached: creating a probe WebGL context is costly. */
export function hasWebGL(): boolean {
  if (cached !== undefined) return cached;
  cached = probe();
  return cached;
}

function probe(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
