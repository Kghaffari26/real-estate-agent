/**
 * The Desk's backend (Supabase: Postgres + auth + row-level security; R3).
 *
 * Configuration is read at runtime from `desk-config.json` (written at build time from
 * the SUPABASE_URL / SUPABASE_ANON_KEY secrets; see vite.config.ts), so one build serves
 * every environment and the site works without it: no file, no Desk. The anon key is a
 * public key by design; row-level security protects the data. The service-role key is
 * never shipped. `@supabase/supabase-js` loads only when the Desk is used.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DeskConfig {
  url: string;
  anonKey: string;
}

let config: Promise<DeskConfig | null> | undefined;
let client: Promise<SupabaseClient | null> | undefined;

export function loadDeskConfig(fetcher: typeof fetch = fetch): Promise<DeskConfig | null> {
  config ??= (async () => {
    try {
      const r = await fetcher(`${import.meta.env.BASE_URL}desk-config.json`, { cache: 'no-store' });
      if (!r.ok) return null;
      const c = (await r.json()) as Partial<DeskConfig>;
      return typeof c.url === 'string' && /^https:\/\//.test(c.url) && typeof c.anonKey === 'string' && c.anonKey ? { url: c.url, anonKey: c.anonKey } : null;
    } catch {
      return null;
    }
  })();
  return config;
}

/** The shared client, or null when the Desk isn't configured. */
export function deskClient(): Promise<SupabaseClient | null> {
  client ??= loadDeskConfig().then(async (c) => {
    if (!c) return null;
    const { createClient } = await import('@supabase/supabase-js');
    // PKCE: the magic link returns `?code=` (a query, not a hash), which the hash router leaves alone.
    return createClient(c.url, c.anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  });
  return client;
}

/**
 * Where magic links send people back: the Desk's hash route. With PKCE, Supabase adds
 * `?code=` as a query, which sits before the `#`, so the link opens as
 * `…/?code=…#/desk` and the hash router lands on the Desk by itself.
 */
export const signInRedirect = () => `${window.location.origin}${import.meta.env.BASE_URL}#/desk`;

/**
 * On load: finish a magic-link sign-in (`?code=`). Returns true when it signed someone in.
 *
 * The code is single-use, so it's always stripped from the address (a reload or a
 * bookmark must not replay a spent code); that's a query edit, which only
 * `history.replaceState` can make without reloading. The route changes only when it has
 * to: a failure needs `?signin=failed` for its message, and a link that came back
 * without the Desk route (sent before the route was part of the redirect) still lands
 * there. Those go through `location.replace` on the hash, a real fragment navigation the
 * router hears, rather than a synthetic event.
 */
export async function completeSignInFromUrl(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;
  const c = await deskClient();
  const ok = c ? !(await c.auth.exchangeCodeForSession(code)).error : false;
  params.delete('code');
  const query = params.toString();
  const hash = window.location.hash;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${hash}`);
  const target = ok ? '#/desk' : '#/desk?signin=failed';
  if (!(ok && /^#\/desk(\?|$)/.test(hash))) window.location.replace(target);
  return ok;
}

/** Test hook: forget the cached configuration and client. */
export function resetDeskClient(): void {
  config = undefined;
  client = undefined;
}
