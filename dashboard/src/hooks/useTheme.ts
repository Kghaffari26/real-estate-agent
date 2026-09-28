import { useCallback, useEffect, useState } from 'react';
import { applyTheme, readPreference, resolveTheme, savePreference, systemPrefersDark, type ThemePreference } from '../lib/theme';

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => applyTheme(resolved), [resolved]);

  const setPreference = useCallback((pref: ThemePreference) => {
    savePreference(pref);
    setPreferenceState(pref);
  }, []);

  return { preference, resolved, setPreference };
}
