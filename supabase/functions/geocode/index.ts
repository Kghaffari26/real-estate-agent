// POST /functions/v1/geocode { address } → { matches: GeocodeMatch[] }
//
// The Desk's address lookup (Listing Prep P1). A proxy to the Census Bureau geocoder,
// which has no CORS headers. Supabase verifies the caller's JWT before this runs
// (verify_jwt). Each lookup counts against the caller's limits (20 a minute, 300 a day,
// enforced in the database by geocode_gate, called with the caller's own JWT so the
// identity can't be spoofed), and answers are cached for everyone (90 days; 7 for "no
// match"). Only this function writes the cache, with the service key Supabase provides
// to Edge Functions; it never leaves the server. The logic is _shared/geocode_handler.ts.
import { censusUrl, type GeocodeMatch } from '../_shared/census.ts';
import { handleGeocode, type Gate } from '../_shared/geocode_handler.ts';

const ALLOWED_ORIGINS = [/^https:\/\/kghaffari26\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After, X-Geocode-Cache',
    Vary: 'Origin',
  };
}

async function rpc(name: string, args: unknown, auth: string, apikey: string): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
  const caller = req.headers.get('authorization') ?? '';
  let input: unknown = null;
  try {
    input = await req.json();
  } catch {
    // handled as an invalid address
  }
  const reply = await handleGeocode(input, {
    gate: async (key) => (await rpc('geocode_gate', { address_key: key }, caller, ANON_KEY)) as Gate,
    store: async (key, matches: GeocodeMatch[]) => {
      if (SERVICE_KEY) await rpc('geocode_store', { address_key: key, result: matches }, `Bearer ${SERVICE_KEY}`, SERVICE_KEY);
    },
    census: async (address) => {
      const res = await fetch(censusUrl(address), { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error(`census: ${res.status}`);
      return res.json();
    },
  });
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...headers, ...reply.headers, 'Content-Type': 'application/json' } });
});
