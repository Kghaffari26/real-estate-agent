/**
 * Listing Prep intake (P1) security and integrity, on the real migrations: facts are
 * validated and confirmed only through confirm_facts (and an edit un-confirms them),
 * photos need the seller's consent and the property's own folder (rows and storage
 * objects), consents are an audit trail, the cost book is the managers', and quotes
 * belong to the property's team.
 *
 * PGlite by default; the real local Supabase stack when DESK_TEST_DATABASE_URL is set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, type User } from './db.test-utils';
import vectors from './fixtures/facts-vectors.json';

type Db = Awaited<ReturnType<typeof freshDb>>;
let t: Db;
let alice: User; // manager, Team A
let bob: User; // agent, Team A
let carol: User; // manager, Team B
let teamA: string;
let teamB: string;
let home: string; // a Team A property

const one = async <T>(p: Promise<T[]>) => (await p)[0]!;
const createTeam = (u: User, name: string) => t.as(u, async () => (await one(t.rows<{ id: string }>('select public.create_team($1) as id', [name]))).id);

beforeEach(async () => {
  t = await freshDb();
  alice = await t.user('alice@example.com');
  bob = await t.user('bob@example.com');
  carol = await t.user('carol@example.com');
  teamA = await createTeam(alice, 'Coastline Realty');
  teamB = await createTeam(carol, 'Canyon Homes');
  const { token } = await t.as(alice, () => one(t.rows<{ token: string }>('insert into public.invites (team_id, email, role, invited_by) values ($1, $2, $3, $4) returning token', [teamA, bob.email, 'agent', alice.id])));
  await t.as(bob, () => t.rows('select public.accept_invite($1)', [token]));
  home = await t.as(bob, async () =>
    (await one(t.rows<{ id: string }>(`insert into public.properties (team_id, address, created_by, zip, city, place_id, tract, county_fips) values ($1, '1 Civic Center Plz, Irvine, CA 92606', $2, '92606', 'Irvine', '0636770', '06059052521', '06059') returning id`, [teamA, bob.id]))).id,
  );
}, 60_000);

afterEach(async () => {
  await t?.close();
});

const setFacts = (u: User, facts: unknown) => t.as(u, () => t.rows('update public.properties set facts = $2::jsonb where id = $1 returning id', [home, JSON.stringify(facts)]));
const confirm = (u: User) => t.as(u, () => t.rows('select public.confirm_facts($1) as at', [home]));
const confirmed = async () => (await one(t.rows<{ at: string | null }>('select facts_confirmed_at as at from public.properties where id = $1', [home]))).at;
const CORE = { beds: 3, baths: 2.5, sqft: 1850, year_built: 1978, property_type: 'single_family' };

describe('facts', () => {
  it('accepts known keys in range and rejects the rest (the vectors lib/intake.ts is tested on)', async () => {
    for (const good of vectors.valid) await setFacts(bob, good);
    for (const bad of vectors.invalid) await expect(setFacts(bob, bad), JSON.stringify(bad)).rejects.toThrow();
  });

  it('are confirmed only through confirm_facts, with the core facts present; an edit un-confirms them', async () => {
    await setFacts(bob, { beds: 3, sqft: 1850 });
    await expect(confirm(bob)).rejects.toThrow(/facts incomplete: baths, year_built, property_type/);
    await setFacts(bob, CORE);
    await confirm(bob);
    expect(await confirmed()).not.toBeNull();
    // Not directly settable, by anyone on the team.
    await expect(t.as(alice, () => t.rows('update public.properties set facts_confirmed_at = now() where id = $1', [home]))).rejects.toThrow();
    // Other changes keep the confirmation; a facts edit drops it.
    await t.as(bob, () => t.rows(`update public.properties set notes = 'call Tue' where id = $1`, [home]));
    expect(await confirmed()).not.toBeNull();
    await setFacts(bob, { ...CORE, sqft: 1900 });
    expect(await confirmed()).toBeNull();
  });

  it('other teams can’t confirm or see the property', async () => {
    await setFacts(bob, CORE);
    await expect(confirm(carol)).rejects.toThrow(/no such property/);
    expect(await t.as(carol, () => t.rows('select id from public.properties where id = $1', [home]))).toEqual([]);
  });
});

describe('consent and photos', () => {
  const path = (team = teamA, property = home) => `${team}/${property}/${crypto.randomUUID()}.jpg`;
  const addPhoto = (u: User, p = path(), property = home) =>
    t.as(u, () => t.rows(`insert into public.photos (property_id, room, storage_path, bytes, mime, uploaded_by) values ($1, 'kitchen', $2, 1000, 'image/jpeg', $3) returning id`, [property, p, u.id]));
  const upload = (u: User, name = path()) => t.as(u, () => t.rows(`insert into storage.objects (bucket_id, name, owner) values ('property-photos', $1, $2) returning name`, [name, u.id]));
  const consent = (u: User) =>
    t.as(u, async () => (await one(t.rows<{ id: string }>(`insert into public.seller_consents (property_id, seller_name, method, consent_version, recorded_by) values ($1, 'Pat Seller', 'signed_form', '2026-10', $2) returning id`, [home, u.id]))).id);

  it('no consent, no photos: neither the row nor the file', async () => {
    await expect(addPhoto(bob)).rejects.toThrow();
    await expect(upload(bob)).rejects.toThrow();
  });

  it('with consent, members add photos only in the property’s own folder', async () => {
    await consent(bob);
    await addPhoto(bob);
    await upload(bob);
    // Another team's folder, a mismatched property, or a different extension: refused.
    await expect(addPhoto(bob, path(teamB))).rejects.toThrow();
    await expect(upload(bob, path(teamB))).rejects.toThrow();
    await expect(upload(bob, `${teamA}/${home}/${crypto.randomUUID()}.png`)).rejects.toThrow();
    // The other team can't read, add or upload.
    await expect(addPhoto(carol)).rejects.toThrow();
    await expect(upload(carol)).rejects.toThrow();
    expect(await t.as(carol, () => t.rows('select id from public.photos'))).toEqual([]);
    expect(await t.as(carol, () => t.rows(`select name from storage.objects where bucket_id = 'property-photos'`))).toEqual([]);
    expect(await t.as(alice, () => t.rows(`select name from storage.objects where bucket_id = 'property-photos'`))).toHaveLength(1);
  });

  it('a revoked consent stops new photos; consents can’t be edited, un-revoked or deleted', async () => {
    const id = await consent(bob);
    await expect(t.as(bob, () => t.rows(`update public.seller_consents set seller_name = 'Someone else' where id = $1`, [id]))).rejects.toThrow();
    await t.as(bob, () => t.rows('update public.seller_consents set revoked_at = now() where id = $1', [id]));
    await expect(t.as(bob, () => t.rows('update public.seller_consents set revoked_at = null where id = $1', [id]))).rejects.toThrow();
    await expect(t.as(alice, () => t.rows('delete from public.seller_consents where id = $1 returning id', [id]))).rejects.toThrow();
    await expect(addPhoto(bob)).rejects.toThrow();
    await expect(upload(bob)).rejects.toThrow();
  });

  it('the bucket is private', async () => {
    expect(await t.rows(`select public from storage.buckets where id = 'property-photos'`)).toEqual([{ public: false }]);
  });
});

describe('cost book and quotes', () => {
  const price = (u: User, team: string, item = 'interior_paint_walls') =>
    t.as(u, () => t.rows(`insert into public.cost_book (team_id, item, category, unit, low_usd, high_usd, updated_by) values ($1, $2, 'paint', 'sq_ft_floor_area', 2.5, 4.5, $3) returning item`, [team, item, u.id]));

  it('managers keep the cost book; agents read it; other teams see nothing', async () => {
    await price(alice, teamA);
    await expect(price(bob, teamA, 'flooring_lvp')).rejects.toThrow();
    expect(await t.as(bob, () => t.rows('select item from public.cost_book'))).toEqual([{ item: 'interior_paint_walls' }]);
    expect(await t.as(carol, () => t.rows('select item from public.cost_book'))).toEqual([]);
    await expect(t.as(bob, () => t.rows(`update public.cost_book set high_usd = 99 where item = 'interior_paint_walls' returning item`))).resolves.toEqual([]);
  });

  it('save_cost_rows imports and re-prices by item, for managers only, without touching ownership', async () => {
    const save = (u: User, team: string, rows: unknown[]) => t.as(u, () => t.rows<{ n: number }>('select public.save_cost_rows($1, $2::jsonb) as n', [team, JSON.stringify(rows)]));
    const rows = [
      { item: 'interior_paint_walls', category: 'paint', unit: 'sq_ft_floor_area', low_usd: 2.5, high_usd: 4.5, notes: 'Walls only, two coats' },
      { item: 'flooring_lvp', category: 'flooring', unit: 'sq_ft', low_usd: null, high_usd: null, notes: null },
    ];
    expect(await save(alice, teamA, rows)).toEqual([{ n: 2 }]);
    await save(alice, teamA, [{ ...rows[1], low_usd: 4.25, high_usd: 7 }]);
    expect(await t.as(bob, () => t.rows('select item, low_usd::float as low, high_usd::float as high from public.cost_book order by item'))).toEqual([
      { item: 'flooring_lvp', low: 4.25, high: 7 },
      { item: 'interior_paint_walls', low: 2.5, high: 4.5 },
    ]);
    await expect(save(bob, teamA, rows)).rejects.toThrow();
    await expect(save(carol, teamA, rows)).rejects.toThrow();
    await expect(save(alice, teamA, [{ ...rows[0], low_usd: 9, high_usd: 1 }])).rejects.toThrow();
    // A plain upsert would SET team_id and item, which no one may update.
    await expect(t.as(alice, () => t.rows(`insert into public.cost_book (team_id, item, category, unit, updated_by) values ($1, 'flooring_lvp', 'flooring', 'sq_ft', $2) on conflict (team_id, item) do update set team_id = excluded.team_id`, [teamA, alice.id]))).rejects.toThrow();
  });

  it('prices are a low ≤ high pair or empty', async () => {
    await expect(t.as(alice, () => t.rows(`insert into public.cost_book (team_id, item, category, unit, low_usd, high_usd, updated_by) values ($1, 'x_item', 'paint', 'each', 5, 2, $2)`, [teamA, alice.id]))).rejects.toThrow();
    await expect(t.as(alice, () => t.rows(`insert into public.cost_book (team_id, item, category, unit, low_usd, updated_by) values ($1, 'y_item', 'paint', 'each', 5, $2)`, [teamA, alice.id]))).rejects.toThrow();
    await t.as(alice, () => t.rows(`insert into public.cost_book (team_id, item, category, unit, updated_by) values ($1, 'z_item', 'paint', 'each', $2)`, [teamA, alice.id]));
  });

  it('quotes belong to the property’s team; agents remove only their own', async () => {
    const add = (u: User) => t.as(u, async () => (await one(t.rows<{ id: string }>(`insert into public.quotes (property_id, item, low_usd, high_usd, vendor, created_by) values ($1, 'interior_paint_walls', 6400, 7200, 'Brightline Painting', $2) returning id`, [home, u.id]))).id);
    const q = await add(alice);
    await expect(add(carol)).rejects.toThrow();
    expect(await t.as(bob, () => t.rows('select vendor from public.quotes'))).toEqual([{ vendor: 'Brightline Painting' }]);
    expect(await t.as(bob, () => t.rows('delete from public.quotes where id = $1 returning id', [q]))).toEqual([]);
    expect(await t.as(alice, () => t.rows('delete from public.quotes where id = $1 returning id', [q]))).toEqual([{ id: q }]);
  });

  it('anon sees none of it', async () => {
    for (const table of ['seller_consents', 'photos', 'cost_book', 'quotes']) {
      await expect(t.as(null, () => t.rows(`select * from public.${table}`)), table).rejects.toThrow();
    }
  });

  it('value priors: managers import them with a source; agents read; nothing without a source', async () => {
    const save = (u: User, rows: unknown[]) => t.as(u, () => t.rows<{ n: number }>('select public.save_value_priors($1, $2::jsonb) as n', [teamA, JSON.stringify(rows)]));
    const paint = { item: 'interior_paint_walls', recovery_low: 1.1, recovery_high: 1.8, source: 'Team listings 2024–2026', notes: null };
    expect(await save(alice, [paint])).toEqual([{ n: 1 }]);
    await save(alice, [{ ...paint, recovery_high: 2.0 }]);
    expect(await t.as(bob, () => t.rows('select item, recovery_low::float as lo, recovery_high::float as hi, source from public.value_priors'))).toEqual([
      { item: 'interior_paint_walls', lo: 1.1, hi: 2, source: 'Team listings 2024–2026' },
    ]);
    await expect(save(bob, [paint])).rejects.toThrow();
    await expect(save(carol, [paint])).rejects.toThrow();
    expect(await t.as(carol, () => t.rows('select item from public.value_priors'))).toEqual([]);
    await expect(save(alice, [{ ...paint, source: ' ' }])).rejects.toThrow();
    await expect(save(alice, [{ ...paint, recovery_low: 2, recovery_high: 1 }])).rejects.toThrow();
    await expect(save(alice, [{ ...paint, recovery_low: -0.1 }])).rejects.toThrow();
  });
});
