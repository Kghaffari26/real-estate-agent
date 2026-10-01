/**
 * The Desk's security model (R3), proven on the real migration: team isolation,
 * invites, roles, the last-manager rule, row ownership, favorites, and nothing for
 * anonymous callers. Every table in `public` must have row-level security.
 *
 * Runs on PGlite by default and on the real local Supabase stack when
 * DESK_TEST_DATABASE_URL is set (the `desk-db` CI job; see db.test-utils.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, REAL_DATABASE_URL, type User } from './db.test-utils';

type Db = Awaited<ReturnType<typeof freshDb>>;
let t: Db;
let alice: User; // manager of Team A
let bob: User; // invited to Team A as an agent
let carol: User; // manager of Team B
let teamA: string;
let teamB: string;

const createTeam = (u: User, name: string) => t.as(u, async () => (await t.rows<{ id: string }>('select public.create_team($1) as id', [name]))[0]!.id);

beforeEach(async () => {
  t = await freshDb();
  alice = await t.user('alice@example.com');
  bob = await t.user('bob@example.com');
  carol = await t.user('carol@example.com');
  teamA = await createTeam(alice, 'Coastline Realty');
  teamB = await createTeam(carol, 'Canyon Homes');
}, 60_000);

afterEach(async () => {
  await t?.close();
});

const invite = (from: User, team: string, email: string, role = 'agent') =>
  t.as(from, () => t.rows('insert into public.invites (team_id, email, role, invited_by) values ($1, $2, $3, $4) returning token', [team, email, role, from.id]));
const join = async (u: User, team: string, from: User) => {
  const [{ token }] = (await invite(from, team, u.email)) as [{ token: string }];
  return t.as(u, () => t.rows('select public.accept_invite($1) as team', [token]));
};

describe('teams and membership', () => {
  it('the creator is the first manager; other teams are invisible', async () => {
    const mine = await t.as(alice, () => t.rows<{ name: string }>('select name from public.teams'));
    expect(mine.map((r) => r.name)).toEqual(['Coastline Realty']);
    const members = await t.as(alice, () => t.rows<{ role: string; email: string }>('select role, email from public.team_members'));
    expect(members).toEqual([{ role: 'manager', email: 'alice@example.com' }]);
    expect(await t.as(carol, () => t.rows('select * from public.teams where id = $1', [teamA]))).toEqual([]);
    expect(await t.as(bob, () => t.rows('select * from public.teams'))).toEqual([]); // no team yet
  });

  it('nobody can insert a team or a membership directly', async () => {
    await expect(t.as(bob, () => t.rows(`insert into public.teams (name) values ('Sneaky')`))).rejects.toThrow();
    await expect(t.as(bob, () => t.rows(`insert into public.team_members (team_id, user_id, role) values ($1, $2, 'manager')`, [teamA, bob.id]))).rejects.toThrow();
  });

  it('invites: managers send them, only the addressed account accepts, once', async () => {
    const [{ token }] = (await invite(alice, teamA, 'bob@example.com')) as [{ token: string }];
    const pending = await t.as(bob, () => t.rows<{ team_name: string }>('select team_name from public.my_invites()'));
    expect(pending.map((p) => p.team_name)).toEqual(['Coastline Realty']);
    expect(await t.as(carol, () => t.rows('select * from public.my_invites()'))).toEqual([]);
    await expect(t.as(carol, () => t.rows('select public.accept_invite($1)', [token]))).rejects.toThrow(/no pending invite/);
    await t.as(bob, () => t.rows('select public.accept_invite($1)', [token]));
    const roles = await t.as(bob, () => t.rows<{ email: string; role: string }>('select email, role from public.team_members order by email'));
    expect(roles).toEqual([
      { email: 'alice@example.com', role: 'manager' },
      { email: 'bob@example.com', role: 'agent' },
    ]);
    await expect(t.as(bob, () => t.rows('select public.accept_invite($1)', [token]))).rejects.toThrow(/no pending invite/); // used
  });

  it('agents cannot invite, see invites, promote themselves or remove others', async () => {
    await join(bob, teamA, alice);
    await expect(invite(bob, teamA, 'dave@example.com')).rejects.toThrow();
    expect(await t.as(bob, () => t.rows('select * from public.invites'))).toEqual([]);
    await expect(t.as(bob, () => t.rows(`update public.team_members set role = 'manager' where user_id = $1`, [bob.id]))).rejects.toThrow(/only a manager/);
    const removed = await t.as(bob, () => t.rows('delete from public.team_members where user_id = $1 returning user_id', [alice.id]));
    expect(removed).toEqual([]);
    // …but can rename themselves and leave.
    await t.as(bob, () => t.rows(`update public.team_members set display_name = 'Bob R.' where user_id = $1`, [bob.id]));
    await t.as(bob, () => t.rows('delete from public.team_members where user_id = $1', [bob.id]));
    expect(await t.as(bob, () => t.rows('select * from public.teams'))).toEqual([]);
  });

  it('a team always keeps a manager; a manager can promote and remove', async () => {
    await expect(t.as(alice, () => t.rows('delete from public.team_members where user_id = $1', [alice.id]))).rejects.toThrow(/at least one manager/);
    await expect(t.as(alice, () => t.rows(`update public.team_members set role = 'agent' where user_id = $1`, [alice.id]))).rejects.toThrow(/at least one manager/);
    await join(bob, teamA, alice);
    await t.as(alice, () => t.rows(`update public.team_members set role = 'manager' where user_id = $1`, [bob.id]));
    await t.as(alice, () => t.rows('delete from public.team_members where user_id = $1', [alice.id])); // now allowed
    expect(await t.as(bob, () => t.rows<{ email: string }>('select email from public.team_members'))).toEqual([{ email: 'bob@example.com' }]);
  });

  it('expired invites cannot be accepted', async () => {
    await t.as(alice, () => t.rows(`insert into public.invites (team_id, email, invited_by, expires_at) values ($1, 'bob@example.com', $2, now() - interval '1 day')`, [teamA, alice.id]));
    expect(await t.as(bob, () => t.rows('select * from public.my_invites()'))).toEqual([]);
  });
});

describe('team-owned rows', () => {
  const addProperty = (u: User, team: string, address = '1 Main St, Irvine, CA 92618') =>
    t.as(u, async () => (await t.rows<{ id: string }>('insert into public.properties (team_id, address, created_by) values ($1, $2, $3) returning id', [team, address, u.id]))[0]!.id);

  it('members share their team’s properties; other teams see and change nothing', async () => {
    await join(bob, teamA, alice);
    const p = await addProperty(bob, teamA);
    expect(await t.as(alice, () => t.rows('select id from public.properties'))).toEqual([{ id: p }]);
    expect(await t.as(carol, () => t.rows('select id from public.properties'))).toEqual([]);
    expect(await t.as(carol, () => t.rows(`update public.properties set notes = 'x' where id = $1 returning id`, [p]))).toEqual([]);
    expect(await t.as(carol, () => t.rows('delete from public.properties where id = $1 returning id', [p]))).toEqual([]);
    await expect(addProperty(carol, teamA)).rejects.toThrow(/row-level security/);
  });

  it('rows cannot be moved to another team or re-attributed', async () => {
    const p = await addProperty(alice, teamA);
    await expect(t.as(alice, () => t.rows('update public.properties set team_id = $1 where id = $2', [teamB, p]))).rejects.toThrow(/permission denied/);
    await expect(t.as(alice, () => t.rows('update public.properties set created_by = $1 where id = $2', [bob.id, p]))).rejects.toThrow(/permission denied/);
    await expect(t.as(alice, () => t.rows('insert into public.properties (team_id, address, created_by) values ($1, $2, $3)', [teamA, '2 Elm St', bob.id]))).rejects.toThrow(/row-level security/);
  });

  it('agents delete only what they created; managers delete any team row', async () => {
    await join(bob, teamA, alice);
    const mine = await addProperty(alice, teamA, '3 Oak St');
    const bobs = await addProperty(bob, teamA, '4 Pine St');
    expect(await t.as(bob, () => t.rows('delete from public.properties where id = $1 returning id', [mine]))).toEqual([]);
    expect(await t.as(bob, () => t.rows('delete from public.properties where id = $1 returning id', [bobs]))).toEqual([{ id: bobs }]);
    expect(await t.as(alice, () => t.rows('delete from public.properties where id = $1 returning id', [mine]))).toEqual([{ id: mine }]);
  });

  it('favorites are per person and only on your team’s properties', async () => {
    await join(bob, teamA, alice);
    const p = await addProperty(alice, teamA);
    await t.as(alice, () => t.rows('insert into public.favorites (property_id, user_id) values ($1, $2)', [p, alice.id]));
    expect(await t.as(bob, () => t.rows('select * from public.favorites'))).toEqual([]);
    await expect(t.as(carol, () => t.rows('insert into public.favorites (property_id, user_id) values ($1, $2)', [p, carol.id]))).rejects.toThrow(/row-level security/);
    await expect(t.as(bob, () => t.rows('insert into public.favorites (property_id, user_id) values ($1, $2)', [p, alice.id]))).rejects.toThrow(/row-level security/);
  });
});

describe('anonymous callers and coverage', () => {
  it('anon can read nothing and call nothing', async () => {
    for (const table of ['teams', 'team_members', 'invites', 'properties', 'favorites']) {
      await expect(t.as(null, () => t.rows(`select * from public.${table}`)), table).rejects.toThrow(/permission denied/);
    }
    await expect(t.as(null, () => t.rows(`select public.create_team('x')`))).rejects.toThrow(/permission denied/);
    await expect(t.as(null, () => t.rows('select * from public.my_invites()'))).rejects.toThrow(/permission denied/);
  });

  it('every table in public has row-level security on', async () => {
    const open = await t.rows<{ relname: string }>(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(open).toEqual([]);
  });

  it('signed-in users can call exactly the functions meant for them (Supabase grants new ones by default)', async () => {
    const callable = async (role: string) =>
      (
        await t.rows<{ proname: string }>(
          `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype and has_function_privilege($1, p.oid, 'execute')
           order by 1`,
          [role],
        )
      ).map((r) => r.proname);
    expect(await callable('authenticated')).toEqual([
      'accept_invite',
      'confirm_facts',
      'create_team',
      'facts_confirmed',
      'geocode_gate',
      'has_photo_consent',
      'is_manager',
      'is_member',
      'my_invites',
      'photo_path_ok',
      'photo_property',
      'processing_consent',
      'property_team',
      'purge_property_photos',
      'save_cost_rows',
      'save_value_priors',
      'valid_facts',
    ]);
    expect(await callable('anon')).toEqual([]);
  });

  it('deleting a team (service role) cascades past the last-manager rule', async () => {
    await t.admin(`delete from public.teams where id = '${teamB}'`);
    expect(await t.rows('select * from public.team_members where team_id = $1', [teamB])).toEqual([]);
  });
});

describe.runIf(Boolean(REAL_DATABASE_URL))('on the real Supabase stack', () => {
  it('uses Supabase’s own auth schema, not the test stand-in', async () => {
    const [row] = await t.rows<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_schema = 'auth' and table_name = 'users'`);
    const n = row?.n ?? 0;
    expect(t.real).toBe(true);
    expect(n).toBeGreaterThan(10); // the stand-in has 4 columns
  });
});
