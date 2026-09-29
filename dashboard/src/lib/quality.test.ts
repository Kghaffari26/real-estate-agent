import { describe, expect, it } from 'vitest';
import { detectTier, parseTier, qualitySettings, type DeviceHints } from './quality';

const desktop: DeviceHints = { webgl: true, webgl2: true, renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)', memoryGb: 8, cores: 8, mobile: false };

describe('quality tiers', () => {
  it('detects from hints', () => {
    expect(detectTier(desktop)).toBe('high');
    expect(detectTier({ ...desktop, webgl2: false })).toBe('low'); // no WebGL2 → the 2D designs
    expect(detectTier({ ...desktop, webgl: false, webgl2: false })).toBe('low');
    expect(detectTier({ ...desktop, memoryGb: 1 })).toBe('low');
    expect(detectTier({ ...desktop, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' })).toBe('medium');
    expect(detectTier({ ...desktop, mobile: true })).toBe('medium');
    expect(detectTier({ ...desktop, saveData: true })).toBe('medium');
    expect(detectTier({ ...desktop, cores: 4 })).toBe('medium');
    expect(detectTier({ ...desktop, memoryGb: null, cores: null, renderer: null })).toBe('high'); // unknown isn't a downgrade
  });

  it('accepts only known overrides', () => {
    expect(parseTier('low')).toBe('low');
    expect(parseTier('medium')).toBe('medium');
    expect(parseTier('ultra')).toBeNull();
    expect(parseTier(null)).toBeNull();
  });

  it('maps a tier to settings; reduced motion is medium minus animation', () => {
    expect(qualitySettings('high')).toEqual({ tier: 'high', webgl: true, dpr: 2, terrain: true, buildingsMinZoom: 12, animate: true, autoplay: true, saveData: false });
    expect(qualitySettings('medium')).toMatchObject({ webgl: true, dpr: 1.5, terrain: false, buildingsMinZoom: 13 });
    expect(qualitySettings('low')).toMatchObject({ webgl: false, dpr: 1, terrain: false });
    expect(qualitySettings('high', { reducedMotion: true })).toMatchObject({ tier: 'medium', dpr: 1.5, terrain: false, animate: false, autoplay: false });
    expect(qualitySettings('low', { reducedMotion: true })).toMatchObject({ tier: 'low', animate: false });
    expect(qualitySettings('high', { saveData: true })).toMatchObject({ animate: true, autoplay: false });
  });
});
