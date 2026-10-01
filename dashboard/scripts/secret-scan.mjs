// Finds backend secrets that must never ship to the browser (pure; used by
// check-secrets.mjs on dist/ and by the Vite plugin that writes desk-config.json).
//
//   - a JWT whose payload says role = service_role (Supabase's legacy secret key) or
//     supabase_admin;
//   - a Supabase secret API key (`sb_secret_…`);
//   - a desk-config.json with anything but { url, anonKey }, a non-https URL (http only
//     for localhost), or an
//     anonKey that isn't public (it must be an anon JWT or an `sb_publishable_` key).

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{8,}/g;
const PRIVILEGED = new Set(['service_role', 'supabase_admin']);

/** The decoded payload of a JWT-shaped string, or null. */
export function jwtPayload(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** Findings in one text: [{ kind, detail }]. */
export function scanText(text) {
  const findings = [];
  for (const m of text.matchAll(JWT)) {
    const payload = jwtPayload(m[0]);
    if (payload && PRIVILEGED.has(payload.role)) findings.push({ kind: 'service-role JWT', detail: `role=${payload.role} at offset ${m.index}` });
  }
  for (const m of text.matchAll(SECRET_KEY)) findings.push({ kind: 'Supabase secret key', detail: `${m[0].slice(0, 14)}… at offset ${m.index}` });
  return findings;
}

/** Problems with a desk-config.json body (an object). [] when it's acceptable. */
export function checkDeskConfig(config) {
  const problems = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['not a JSON object'];
  const extra = Object.keys(config).filter((k) => k !== 'url' && k !== 'anonKey');
  if (extra.length) problems.push(`unexpected keys: ${extra.join(', ')} (only url and anonKey may be published)`);
  // https, or http on this machine for a local `supabase start` stack.
  const url = typeof config.url === 'string' ? config.url : '';
  if (!/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) problems.push('url must be an https URL');
  const key = config.anonKey;
  if (typeof key !== 'string' || !key) problems.push('anonKey is missing');
  else if (key.startsWith('sb_secret_')) problems.push('anonKey is a Supabase secret key; use the publishable (anon) key');
  else if (!key.startsWith('sb_publishable_')) {
    const payload = jwtPayload(key);
    if (!payload) problems.push('anonKey is neither an anon JWT nor an sb_publishable_ key');
    else if (payload.role !== 'anon') problems.push(`anonKey has role=${payload.role}; only the anon key may be published`);
  }
  return problems;
}
