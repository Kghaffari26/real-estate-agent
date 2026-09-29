import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { currentTier, qualitySettings, type QualitySettings } from '../lib/quality';
import { usePrefersReducedMotion } from './useMediaQuery';

/** This page's quality settings (spec §9): `?tier=` if given, else the detected tier, with reduced motion applied. */
export function useQuality(): QualitySettings {
  const [params] = useSearchParams();
  const reduce = usePrefersReducedMotion();
  const raw = params.get('tier');
  return useMemo(() => {
    const { tier, saveData } = currentTier(raw ? `tier=${encodeURIComponent(raw)}` : '');
    return qualitySettings(tier, { reducedMotion: reduce, saveData });
  }, [raw, reduce]);
}
