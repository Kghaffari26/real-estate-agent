/**
 * P2 groundwork, on the real migrations: consent is enforced when photos are processed
 * and shown (revoking hides photos and files, withdraws findings, cancels jobs), every
 * deleted photo queues its file, retention and orphans are purged, findings are the
 * worker's to write and the agents' to review, and the geocode function's rate limit
 * and cache can't be bypassed or poisoned.
 *
 * PGlite by default; the real local Supabase stack when DESK_TEST_DATABASE_URL is set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, type User } from './db.test-utils';

type Db = Awaited<ReturnType<typeof freshDb>>;
let t: Db;
let alice: User; // manager, Team A
let bob: User; // agent, Team A
let carol: User; // manager, Team B
let teamA: string;
let home: string;
let consentId: string;

const one = async <T>(p: Promise<T[]>) => (await p)[0]!;
const CORE = { beds: 3, baths: 2.5, sqft: 1850, year_built: 1978, property_type: 'single_family' };

beforeEach(async () => {
  t = await freshDb();
  alice = await t.user('alice@example.com');
  bob = await t.user('bob@example.com');
  carol = await t.user('carol@example.com');
  teamA = await t.as(alice, async () => (await one(t.rows<{ id: string }>('select public.create_team($1) as id', ['Coastline Realty']))).id);
  await t.as(carol, () => t.rows('select public.create_team($1)', ['Canyon Homes']));
  const { token } = await t.as(alice, () => one(t.rows<{ token: string }>('insert into public.invites (team_id, email, role, invited_by) values ($1, $2, $3, $4) returning token', [teamA, bob.email, 'agent', alice.id])));
  await t.as(bob, () => t.rows('select public.accept_invite($1)', [token]));
  home = await t.as(bob, async () => (await one(t.rows<{ id: string }>(`insert into public.properties (team_id, address, created_by, facts) values ($1, '1 Civic Center Plz, Irvine', $2, $3::jsonb) returning id`, [teamA, bob.id, JSON.stringify(CORE)]))).id);
  consentId = await consent(bob);
}, 60_000);

afterEach(async () => {
  await t?.close();
});

async function consent(u: User) {
  return t.as(u, async () => (await one(t.rows<{ id: string }>(`insert into public.seller_consents (property_id, seller_name, method, consent_version, recorded_by) values ($1, 'Pat Seller', 'signed_form', '2026-10b', $2) returning id`, [home, u.id]))).id);
}
const revoke = (u: User, id = consentId) => t.as(u, () => t.rows('update public.seller_consents set revoked_at = now() where id = $1', [id]));
const path = () => `${teamA}/${home}/${crypto.randomUUID()}.jpg`;
async function addPhoto(u: User) {
  const p = path();
  await t.as(u, () => t.rows(`insert into storage.objects (bucket_id, name, owner) values ('property-photos', $1, $2)`, [p, u.id]));
  const id = await t.as(u, async () => (await one(t.rows<{ id: string }>(`insert into public.photos (property_id, room, storage_path, bytes, mime, uploaded_by) values ($1, 'kitchen', $2, 1000, 'image/jpeg', $3) returning id`, [home, p, u.id]))).id);
  return { id, path: p };
}
const confirm = () => t.as(bob, () => t.rows('select public.confirm_facts($1)', [home]));
const requestJob = (u: User) => t.as(u, async () => (await one(t.rows<{ id: string }>('insert into public.vision_jobs (property_id, requested_by) values ($1, $2) returning id', [home, u.id]))).id);
const finding = (photo: string, job: string | null = null) =>
  t.service(() => t.rows<{ id: string }>(`insert into public.findings (property_id, photo_id, job_id, room, category, condition, issue, suggested_fix, fix_item, severity, evidence) values ($1, $2, $3, 'kitchen', 'cabinets', 2, 'Cabinet doors are worn at the edges', 'Refinish the cabinet doors', 'cabinet_refinish', 'cosmetic', '{"x":0.1,"y":0.2,"w":0.3,"h":0.25}') returning id`, [home, photo, job]));
const deletions = () => t.rows<{ path: string; reason: string }>('select path, reason from public.storage_deletions order by id');

describe('consent at processing and display time', () => {
  it('revoking hides the photos and their files; a new consent shows them again', async () => {
    const photo = await addPhoto(bob);
    await revoke(bob);
    expect(await t.as(bob, () => t.rows('select id from public.photos'))).toEqual([]);
    expect(await t.as(alice, () => t.rows(`select name from storage.objects where bucket_id = 'property-photos'`))).toEqual([]);
    // Hidden photos can't be relabelled or deleted by agents…
    expect(await t.as(bob, () => t.rows(`update public.photos set room = 'dining' where id = $1 returning id`, [photo.id]))).toEqual([]);
    expect(await t.as(bob, () => t.rows('delete from public.photos where id = $1 returning id', [photo.id]))).toEqual([]);
    await consent(bob);
    expect(await t.as(bob, () => t.rows('select id from public.photos'))).toEqual([{ id: photo.id }]);
  });

  it('revoking withdraws the findings and cancels the analysis; nothing new can be written', async () => {
    const photo = await addPhoto(bob);
    await confirm();
    const job = await requestJob(bob);
    await t.service(() => t.rows('select id from public.claim_vision_job()'));
    const [{ id }] = (await finding(photo.id, job)) as [{ id: string }];
    await t.as(bob, () => t.rows(`update public.findings set status = 'confirmed' where id = $1`, [id]));
    await revoke(bob);
    expect(await t.as(alice, () => t.rows('select status from public.findings'))).toEqual([{ status: 'withdrawn' }]);
    expect(await t.as(alice, () => t.rows('select status, error from public.vision_jobs'))).toEqual([{ status: 'cancelled', error: 'consent_revoked' }]);
    await expect(finding(photo.id, job)).rejects.toThrow(/consent revoked/);
    // Withdrawn stays withdrawn, even after a new consent.
    await consent(bob);
    await expect(t.as(alice, () => t.rows(`update public.findings set status = 'confirmed' where id = $1`, [id]))).rejects.toThrow(/withdrawn/);
  });

  it('only a consent under the text that discloses AI processing allows analysis', async () => {
    await confirm();
    await revoke(bob);
    await t.as(bob, () => t.rows(`insert into public.seller_consents (property_id, seller_name, method, consent_version, recorded_by) values ($1, 'Pat Seller', 'signed_form', '2026-10', $2)`, [home, bob.id]));
    const photo = await addPhoto(bob); // photos still work under the older text
    await expect(requestJob(bob)).rejects.toThrow();
    await expect(finding(photo.id)).rejects.toThrow(/consent revoked/);
    expect(await t.service(() => t.rows('select public.processing_consent($1) as ok', [home]))).toEqual([{ ok: false }]);
    await consent(bob); // 2026-10b
    await requestJob(bob);
  });

  it('a job needs confirmed facts and consent; one active job per property', async () => {
    await expect(requestJob(bob)).rejects.toThrow(); // facts not confirmed
    await confirm();
    await requestJob(bob);
    await expect(requestJob(alice)).rejects.toThrow(); // one active job
    await expect(requestJob(carol)).rejects.toThrow(); // other team
    await revoke(bob); // cancels the active job
    await expect(requestJob(bob)).rejects.toThrow(); // no consent
  });
});

describe('findings: the worker writes, agents review', () => {
  it('agents can’t insert, delete or withdraw findings; they confirm, edit and reject', async () => {
    const photo = await addPhoto(bob);
    await expect(t.as(bob, () => t.rows(`insert into public.findings (property_id, room, category, condition, issue) values ($1, 'kitchen', 'paint', 2, 'Scuffed walls')`, [home]))).rejects.toThrow();
    const [{ id }] = (await finding(photo.id)) as [{ id: string }];
    await t.as(bob, () => t.rows(`update public.findings set status = 'edited', issue = 'Cabinet doors worn at the edges and corners', agent_note = 'Seen in person' where id = $1`, [id]));
    expect(await t.as(alice, () => t.rows('select status, reviewed_by from public.findings'))).toEqual([{ status: 'edited', reviewed_by: bob.id }]);
    await expect(t.as(bob, () => t.rows(`update public.findings set status = 'withdrawn' where id = $1`, [id]))).rejects.toThrow(/only a consent revocation/);
    await expect(t.as(bob, () => t.rows(`update public.findings set property_id = $2 where id = $1`, [id, home]))).rejects.toThrow();
    await expect(t.as(bob, () => t.rows('delete from public.findings where id = $1', [id]))).rejects.toThrow(/permission denied/);
    expect(await t.as(carol, () => t.rows('select id from public.findings'))).toEqual([]);
    expect(await t.as(null, () => t.rows('select id from public.findings')).catch(() => 'denied')).toBe('denied');
  });

  it('the worker claims queued jobs one at a time; agents can’t claim', async () => {
    await confirm();
    const job = await requestJob(bob);
    await expect(t.as(bob, () => t.rows('select * from public.claim_vision_job()'))).rejects.toThrow();
    expect((await t.service(() => t.rows<{ id: string; status: string }>('select id, status from public.claim_vision_job()'))).map((r) => [r.id, r.status])).toEqual([[job, 'running']]);
    expect(await t.service(() => t.rows('select id from public.claim_vision_job()'))).toEqual([]);
  });
});

describe('photo files follow their rows', () => {
  it('deleting a photo, or its property, queues the files for deletion', async () => {
    const a = await addPhoto(bob);
    const b = await addPhoto(bob);
    await t.as(bob, () => t.rows('delete from public.photos where id = $1', [a.id]));
    expect(await deletions()).toEqual([{ path: a.path, reason: 'photo_deleted' }]);
    await t.as(alice, () => t.rows('delete from public.properties where id = $1', [home]));
    expect((await deletions()).map((d) => d.path)).toEqual([a.path, b.path]);
    expect(await t.as(alice, () => t.rows('select * from public.storage_deletions')).catch(() => 'denied')).toBe('denied');
  });

  it('a manager can purge hidden photos, even with withdrawn findings on them; an agent can’t', async () => {
    const a = await addPhoto(bob);
    await confirm();
    await finding(a.id);
    await revoke(bob);
    await expect(t.as(bob, () => t.rows('select public.purge_property_photos($1)', [home]))).rejects.toThrow(/only a manager/);
    expect(await t.as(alice, () => t.rows<{ n: number }>('select public.purge_property_photos($1) as n', [home]))).toEqual([{ n: 1 }]);
    expect((await deletions()).map((d) => d.path)).toEqual([a.path]);
    expect(await t.as(alice, () => t.rows('select status, photo_id from public.findings'))).toEqual([{ status: 'withdrawn', photo_id: null }]);
  });

  it('retention: a year after upload, or 30 days after consent is revoked; orphans after a day', async () => {
    const old = await addPhoto(bob);
    const fresh = await addPhoto(bob);
    await t.admin(`update public.photos set created_at = now() - interval '400 days' where id = '${old.id}'`);
    expect(await t.service(() => t.rows<{ n: number }>('select public.expire_photos() as n'))).toEqual([{ n: 1 }]);
    // Revoked 29 days ago: kept. (Revocations can't be re-dated, so this one is set once.)
    await t.admin(`update public.seller_consents set revoked_at = now() - interval '29 days' where id = '${consentId}'`);
    expect(await t.service(() => t.rows<{ n: number }>('select public.expire_photos() as n'))).toEqual([{ n: 0 }]);
    // Another property whose consent was revoked 31 days ago: purged.
    const other = await t.as(bob, async () => (await one(t.rows<{ id: string }>(`insert into public.properties (team_id, address, created_by) values ($1, '2 Main St, Irvine', $2) returning id`, [teamA, bob.id]))).id);
    const otherConsent = await t.as(bob, async () => (await one(t.rows<{ id: string }>(`insert into public.seller_consents (property_id, seller_name, method, consent_version, recorded_by) values ($1, 'Lee Seller', 'email', '2026-10b', $2) returning id`, [other, bob.id]))).id);
    const otherPath = `${teamA}/${other}/${crypto.randomUUID()}.jpg`;
    await t.as(bob, () => t.rows(`insert into public.photos (property_id, room, storage_path, bytes, mime, uploaded_by) values ($1, 'kitchen', $2, 1000, 'image/jpeg', $3)`, [other, otherPath, bob.id]));
    await t.admin(`update public.seller_consents set revoked_at = now() - interval '31 days' where id = '${otherConsent}'`);
    expect(await t.service(() => t.rows<{ n: number }>('select public.expire_photos() as n'))).toEqual([{ n: 1 }]);
    expect((await deletions()).map((d) => d.path)).toEqual([old.path, otherPath]);
    expect(await t.rows('select id from public.photos where id = $1', [fresh.id])).toHaveLength(1);
    // An uploaded file without a row, older than a day.
    const orphan = `${teamA}/${home}/${crypto.randomUUID()}.jpg`;
    await t.admin(`insert into storage.objects (bucket_id, name, created_at) values ('property-photos', '${orphan}', now() - interval '2 days')`);
    expect(await t.service(() => t.rows<{ n: number }>('select public.queue_orphan_photos() as n'))).toEqual([{ n: 1 }]);
    expect(await t.service(() => t.rows<{ n: number }>('select public.queue_orphan_photos() as n'))).toEqual([{ n: 0 }]);
    await expect(t.as(alice, () => t.rows('select public.expire_photos()'))).rejects.toThrow();
  });
});

describe('the geocode function’s limits and cache', () => {
  const gate = (u: User, key = '1 civic center plaza, irvine, ca') => t.as(u, async () => (await one(t.rows<{ g: { allowed: boolean; cached: unknown; retry_after?: number } }>('select public.geocode_gate($1) as g', [key]))).g);

  it('allows 20 lookups a minute per person', async () => {
    for (let i = 0; i < 20; i++) expect((await gate(bob)).allowed).toBe(true);
    expect(await gate(bob)).toEqual({ allowed: false, retry_after: 60 });
    expect((await gate(alice)).allowed).toBe(true); // per person
    await expect(t.as(null, () => t.rows(`select public.geocode_gate('x')`))).rejects.toThrow();
  });

  it('serves the cache; only the service role writes it', async () => {
    expect((await gate(bob)).cached).toBeNull();
    const matches = [{ matchedAddress: '1 CIVIC CENTER PLZ, IRVINE, CA, 92606', zip: '92606' }];
    await expect(t.as(bob, () => t.rows('select public.geocode_store($1, $2::jsonb)', ['1 civic center plaza, irvine, ca', JSON.stringify([{ matchedAddress: 'FAKE' }])]))).rejects.toThrow();
    await expect(t.as(bob, () => t.rows(`insert into public.geocode_cache (key, matches) values ('1 civic center plaza, irvine, ca', '[]')`))).rejects.toThrow();
    await t.service(() => t.rows('select public.geocode_store($1, $2::jsonb)', ['1 civic center plaza, irvine, ca', JSON.stringify(matches)]));
    expect((await gate(bob)).cached).toEqual(matches);
    // Stale entries are misses: 90 days for a match.
    await t.admin(`update public.geocode_cache set fetched_at = now() - interval '91 days'`);
    expect((await gate(bob)).cached).toBeNull();
  });
});

describe('property insights (P3): the worker writes, members read', () => {
  const queue = () => t.service(() => t.rows<{ id: string }>('select id from public.properties_needing_insights()'));
  const write = () => t.service(() => t.rows(`insert into public.property_insights (property_id, valuation) values ($1, '{"low":1,"mid":2,"high":3}') on conflict (property_id) do update set computed_at = now()`, [home]));

  it('queues confirmed properties without insights; members read, nobody else writes', async () => {
    expect(await queue()).toEqual([]); // facts not confirmed yet
    await confirm();
    expect(await queue()).toEqual([{ id: home }]);
    await write();
    expect(await queue()).toEqual([]);
    expect(await t.as(bob, () => t.rows('select valuation from public.property_insights'))).toEqual([{ valuation: { low: 1, mid: 2, high: 3 } }]);
    expect(await t.as(carol, () => t.rows('select property_id from public.property_insights'))).toEqual([]);
    await expect(t.as(alice, () => t.rows(`insert into public.property_insights (property_id) values ($1)`, [home]))).rejects.toThrow();
    await expect(t.as(alice, () => t.rows('select * from public.properties_needing_insights()'))).rejects.toThrow();
  });

  it('editing the facts clears them; a newer review or 30 days queues a refresh', async () => {
    await confirm();
    await write();
    await t.as(bob, () => t.rows(`update public.properties set facts = facts || '{"sqft": 1900}'::jsonb where id = $1`, [home]));
    expect(await t.rows('select property_id from public.property_insights')).toEqual([]);
    await confirm();
    await write();
    const photo = await addPhoto(bob);
    const [{ id }] = (await finding(photo.id)) as [{ id: string }];
    await t.admin(`update public.property_insights set computed_at = now() - interval '1 minute'`);
    await t.as(bob, () => t.rows(`update public.findings set status = 'confirmed' where id = $1`, [id]));
    expect(await queue()).toEqual([{ id: home }]); // reviewed after the insights
    await write();
    await t.admin(`update public.property_insights set computed_at = now() - interval '31 days'`);
    expect(await queue()).toEqual([{ id: home }]);
  });

  it('a pinned property whose amenities failed is retried within the hour, with its previous answer', async () => {
    await confirm();
    await t.admin(`update public.properties set lat = 33.6875, lon = -117.8263, facts_confirmed_at = now() - interval '3 hours' where id = '${home}'`);
    await t.service(() => t.rows(`insert into public.property_insights (property_id, amenities, computed_at) values ($1, null, now() - interval '30 minutes')`, [home]));
    expect(await queue()).toEqual([]);
    await t.admin(`update public.property_insights set computed_at = now() - interval '2 hours'`);
    expect(await queue()).toEqual([{ id: home }]);
    await t.admin(`update public.property_insights set amenities = '[{"kind":"park","count":2}]', amenities_point = '33.68750,-117.82630', amenities_fetched_at = now() - interval '2 days'`);
    expect(await queue()).toEqual([]);
    // Due again (30 days): the worker gets the stored answer to reuse.
    await t.admin(`update public.property_insights set computed_at = now() - interval '31 days'`);
    expect(await t.service(() => t.rows('select prev_amenities, prev_amenities_point from public.properties_needing_insights(5)'))).toEqual([
      { prev_amenities: [{ kind: 'park', count: 2 }], prev_amenities_point: '33.68750,-117.82630' },
    ]);
  });
});
