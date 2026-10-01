// POST /functions/v1/geocode { address } → { matches: GeocodeMatch[] }
//
// The Desk's address lookup (Listing Prep P1). A thin proxy to the Census Bureau geocoder,
// which has no CORS headers. Supabase verifies the caller's JWT before this runs
// (verify_jwt, the default), so only signed-in users reach it; the function itself holds
// no secrets and reads no database rows.
import { censusUrl, cleanAddress, parseCensus } from '../_shared/census.ts';

const ALLOWED_ORIGINS = [/^https:\/\/kghaffari26\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  let address: string | null = null;
  try {
    address = cleanAddress((await req.json())?.address);
  } catch {
    // fall through
  }
  if (!address) return reply(400, { error: 'invalid_address' });

  try {
    const res = await fetch(censusUrl(address), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return reply(502, { error: 'geocoder_unavailable' });
    return reply(200, { matches: parseCensus(await res.json()) });
  } catch {
    return reply(502, { error: 'geocoder_unavailable' });
  }
});
