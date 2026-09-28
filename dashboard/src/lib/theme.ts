export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_KEY = 're-theme';

export function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function savePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // private mode etc.: the choice just won't persist
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
