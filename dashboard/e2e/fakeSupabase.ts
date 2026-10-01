/**
 * An in-memory fake of the Supabase APIs the Desk uses (auth, PostgREST, RPCs, Storage
 * and the geocode Edge Function), for Playwright. It only stores and returns rows; the
 * real access rules are the database's, proven in src/backend/*.rls.test.ts (on PGlite
 * and, in the desk-db workflow, on a real local Supabase stack).
 */
import type { Page, Route } from '@playwright/test';

export const URL_ = 'https://desk.supabase.test';
export const STORAGE = 'sb-desk-auth-token';
export const ME = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com' };

export interface State {
  teams: Array<{ id: string; name: string }>;
  members: Array<{ team_id: string; user_id: string; role: 'manager' | 'agent'; display_name: string | null; email: string }>;
  invites: Array<{ id: string; team_id: string; email: string; role: 'manager' | 'agent'; expires_at: string; accepted_at: string | null; created_at: string }>;
  myInvites: Array<{ token: string; team_id: string; team_name: string; role: 'manager' | 'agent'; expires_at: string }>;
  otp: string[];
  redirects: string[];
  /** When set, /auth/v1/otp answers with this instead of sending (e.g. Supabase's 429). */
  otpFailure?: { status: number; body: unknown };
  /** Listing Prep tables (properties, seller_consents, photos, cost_book, quotes), by name. */
  tables: Record<string, Row[]>;
  /** Uploaded storage objects: path → the multipart body as sent. */
  files: Map<string, Buffer>;
  /** What the geocode function answers: matches, or 'fail' (a 502). */
  geocode: unknown[] | 'fail';
  geocodeCalls: string[];
  /** Bytes served for any signed photo URL. */
  photoBytes?: Buffer;
}

export type Row = Record<string, unknown>;
const TABLES = ['properties', 'seller_consents', 'photos', 'cost_book', 'quotes', 'vision_jobs', 'photo_results', 'findings', 'property_insights'];
const DEFAULTS: Record<string, () => Row> = {
  properties: () => ({ status: 'watching', facts: {}, facts_confirmed_at: null, facts_confirmed_by: null, notes: null, matched_address: null, lat: null, lon: null, zip: null, city: null, place_id: null, tract: null, county_fips: null }),
  seller_consents: () => ({ revoked_at: null }),
  photos: () => ({ label: null }),
  cost_book: () => ({ notes: null }),
  quotes: () => ({ notes: null, vendor: null, quoted_on: null }),
  vision_jobs: () => ({ status: 'queued', photos_total: null, photos_done: 0, error: null, finished_at: null }),
};
const activeConsent = (s: State, property: unknown) => (s.tables.seller_consents ?? []).some((c) => c.property_id === property && !c.revoked_at);
const RESERVED = new Set(['select', 'order', 'on_conflict', 'limit', 'offset', 'columns']);

/** PostgREST's eq./is. filters and order=col.asc|desc, as supabase-js sends them. */
function filtered(rows: Row[], url: URL): Row[] {
  let out = rows.filter((r) =>
    [...url.searchParams].every(([k, v]) => RESERVED.has(k) || (v === 'is.null' ? r[k] == null : v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true)),
  );
  for (const o of (url.searchParams.get('order') ?? '').split(',').filter(Boolean).reverse()) {
    const [col, dir] = o.split('.');
    out = [...out].sort((a, b) => String(a[col!] ?? '').localeCompare(String(b[col!] ?? '')) * (dir === 'desc' ? -1 : 1));
  }
  return out;
}

async function table(route: Route, s: State, name: string, url: URL, body: unknown) {
  const req = route.request();
  const rows = (s.tables[name] ??= []);
  const object = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  const reply = (out: Row[], status = 200) => json(route, object ? (out[0] ?? null) : out, status);
  if (req.method() === 'GET') {
    // The database hides a property's photos (and their results) without an active consent.
    if (name === 'photos') return reply(filtered(rows, url).filter((r) => activeConsent(s, r.property_id)));
    return reply(filtered(rows, url));
  }
  if (req.method() === 'POST') {
    const merge = (req.headers()['prefer'] ?? '').includes('merge-duplicates');
    const keys = (url.searchParams.get('on_conflict') ?? '').split(',').filter(Boolean);
    const out: Row[] = [];
    for (const item of (Array.isArray(body) ? body : [body]) as Row[]) {
      const existing = merge ? rows.find((r) => keys.every((k) => r[k] === item[k])) : undefined;
      if (existing) Object.assign(existing, item);
      else rows.push({ id: uuid(), created_at: new Date(Date.now() + rows.length).toISOString(), ...DEFAULTS[name]?.(), ...item });
      out.push(existing ?? rows[rows.length - 1]!);
    }
    return reply(out, 201);
  }
  if (req.method() === 'PATCH') {
    const hit = filtered(rows, url);
    for (const r of hit) {
      // The database's trigger: editing the facts un-confirms them.
      if (name === 'properties' && 'facts' in (body as Row) && JSON.stringify(r.facts) !== JSON.stringify((body as Row).facts)) Object.assign(r, { facts_confirmed_at: null, facts_confirmed_by: null });
      Object.assign(r, body);
      // The revocation trigger: withdraw the property's findings, cancel its jobs, clear results.
      if (name === 'seller_consents' && (body as Row).revoked_at && !activeConsent(s, r.property_id)) {
        for (const f of s.tables.findings ?? []) if (f.property_id === r.property_id) f.status = 'withdrawn';
        for (const j of s.tables.vision_jobs ?? []) if (j.property_id === r.property_id && ['queued', 'running'].includes(j.status as string)) Object.assign(j, { status: 'cancelled', error: 'consent_revoked' });
        const photoIds = new Set((s.tables.photos ?? []).filter((p) => p.property_id === r.property_id).map((p) => p.id));
        s.tables.photo_results = (s.tables.photo_results ?? []).filter((x) => !photoIds.has(x.photo_id));
      }
    }
    return reply(hit);
  }
  if (req.method() === 'DELETE') {
    const hit = filtered(rows, url);
    s.tables[name] = rows.filter((r) => !hit.includes(r));
    return reply(hit);
  }
}

export const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const eq = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '');
let n = 100;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export async function fakeBackend(page: Page, s: State) {
  await page.route('**/desk-config.json', (r) => json(r, { url: URL_, anonKey: 'test-anon-key' }));
  await page.route(`${URL_}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = req.postData() ? JSON.parse(req.postData()!) : null;
    } catch {
      // a binary upload
    }
    if (path === '/auth/v1/otp') {
      if (s.otpFailure) return json(route, s.otpFailure.body, s.otpFailure.status);
      s.otp.push(body.email);
      s.redirects.push(url.searchParams.get('redirect_to') ?? '');
      return json(route, {});
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (path === '/auth/v1/user') return json(route, { ...ME, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
    if (path === '/auth/v1/token') return json(route, session());
    if (path === '/rest/v1/rpc/my_invites') return json(route, s.myInvites);
    if (path === '/rest/v1/rpc/create_team') {
      const id = uuid();
      s.teams.push({ id, name: body.team_name });
      s.members.push({ team_id: id, user_id: ME.id, role: 'manager', display_name: null, email: ME.email });
      return json(route, id);
    }
    if (path === '/rest/v1/rpc/accept_invite') {
      const inv = s.myInvites.find((i) => i.token === body.invite_token)!;
      s.teams.push({ id: inv.team_id, name: inv.team_name });
      s.members.push({ team_id: inv.team_id, user_id: ME.id, role: inv.role, display_name: null, email: ME.email });
      s.myInvites = s.myInvites.filter((i) => i !== inv);
      return json(route, inv.team_id);
    }
    if (path === '/rest/v1/teams') return json(route, s.teams.filter((t) => s.members.some((m) => m.team_id === t.id && m.user_id === ME.id)));
    if (path === '/rest/v1/team_members') {
      const team = eq(url, 'team_id');
      const user = eq(url, 'user_id');
      if (req.method() === 'GET') return json(route, s.members.filter((m) => m.team_id === team));
      if (req.method() === 'DELETE') {
        const target = s.members.find((m) => m.team_id === team && m.user_id === user)!;
        if (target.role === 'manager' && !s.members.some((m) => m.team_id === team && m.role === 'manager' && m.user_id !== user)) {
          return json(route, { code: '23514', message: 'a team needs at least one manager', details: null, hint: null }, 400);
        }
        s.members = s.members.filter((m) => m !== target);
        return route.fulfill({ status: 204 });
      }
      if (req.method() === 'PATCH') {
        s.members.filter((m) => m.team_id === team && m.user_id === user).forEach((m) => Object.assign(m, body));
        return route.fulfill({ status: 204 });
      }
    }
    if (path === '/rest/v1/invites') {
      if (req.method() === 'GET') return json(route, s.invites.filter((i) => i.team_id === eq(url, 'team_id') && !i.accepted_at));
      if (req.method() === 'POST') {
        s.invites.push({ id: uuid(), team_id: body.team_id, email: body.email, role: body.role, expires_at: '2026-10-13T00:00:00Z', accepted_at: null, created_at: new Date().toISOString() });
        return route.fulfill({ status: 201 });
      }
      if (req.method() === 'DELETE') {
        s.invites = s.invites.filter((i) => i.id !== eq(url, 'id'));
        return route.fulfill({ status: 204 });
      }
    }
    const tableName = path.replace('/rest/v1/', '');
    if (TABLES.includes(tableName)) return table(route, s, tableName, url, body);
    if (path === '/rest/v1/rpc/confirm_facts') {
      const p = s.tables.properties?.find((r) => r.id === body.property);
      const missing = ['beds', 'baths', 'sqft', 'year_built', 'property_type'].filter((k) => !(k in ((p?.facts as Row) ?? {})));
      if (!p) return json(route, { code: 'P0002', message: 'no such property' }, 400);
      if (missing.length) return json(route, { code: '23514', message: `facts incomplete: ${missing.join(', ')}` }, 400);
      p.facts_confirmed_at = new Date().toISOString();
      p.facts_confirmed_by = ME.id;
      return json(route, p.facts_confirmed_at);
    }
    if (path === '/rest/v1/rpc/purge_property_photos') {
      const gone = (s.tables.photos ?? []).filter((p) => p.property_id === body.property);
      s.tables.photos = (s.tables.photos ?? []).filter((p) => p.property_id !== body.property);
      return json(route, gone.length);
    }
    if (path === '/rest/v1/rpc/save_cost_rows') {
      const book = (s.tables.cost_book ??= []);
      for (const r of body.rows as Row[]) {
        const existing = book.find((x) => x.team_id === body.team && x.item === r.item);
        if (existing) Object.assign(existing, r, { updated_by: ME.id });
        else book.push({ team_id: body.team, ...r, updated_by: ME.id });
      }
      return json(route, (body.rows as Row[]).length);
    }
    if (path === '/functions/v1/geocode') {
      s.geocodeCalls.push(body?.address);
      return s.geocode === 'fail' ? json(route, { error: 'geocoder_unavailable' }, 502) : json(route, { matches: s.geocode });
    }
    const bucket = '/storage/v1/object/property-photos';
    if (path.startsWith(`${bucket}/`) && req.method() === 'POST') {
      const key = decodeURIComponent(path.slice(bucket.length + 1));
      s.files.set(key, req.postDataBuffer() ?? Buffer.alloc(0));
      return json(route, { Key: `property-photos/${key}`, Id: uuid() });
    }
    if (path === bucket && req.method() === 'DELETE') {
      for (const p of body.prefixes as string[]) s.files.delete(p);
      return json(route, []);
    }
    if (path === '/storage/v1/object/sign/property-photos' && req.method() === 'POST') {
      return json(
        route,
        (body.paths as string[]).map((p) => ({ path: p, signedURL: `/object/sign/property-photos/${p}?token=t`, error: null })),
      );
    }
    if (path.startsWith('/storage/v1/object/sign/property-photos/')) return route.fulfill({ status: 200, contentType: 'image/png', body: s.photoBytes ?? Buffer.alloc(0) });
    return json(route, { message: `fake backend: unhandled ${req.method()} ${path}` }, 501);
  });
}

export function session() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { ...ME, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-29T00:00:00Z' },
  };
}

export const signedIn = (page: Page) => page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE, JSON.stringify(session())] as const);
export const newState = (): State => ({ teams: [], members: [], invites: [], myInvites: [], otp: [], redirects: [], tables: {}, files: new Map(), geocode: [], geocodeCalls: [] });

