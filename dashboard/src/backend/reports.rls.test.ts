/**
 * Listing Prep P5 on the real migrations: members request reports on confirmed
 * properties (one queued or running at a time, versions counting up), the worker claims
 * and writes them, members of other teams never see them, and nobody but the service
 * role writes a report's output.
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
}, 60_000);

afterEach(async () => {
  await t?.close();
});

const confirm = () => t.as(bob, () => t.rows('select public.confirm_facts($1)', [home]));
const request = (u: User, price: number | null = 1_450_000, budget: number | null = 25_000, days: number | null = 30) =>
  t.as(u, async () => (await one(t.rows<{ id: string }>('select public.request_report($1, $2, $3, $4) as id', [home, price, budget, days]))).id);
const claim = () => t.service(() => t.rows<{ id: string; status: string; version: number }>('select id, status, version from public.claim_report_job()'));

describe('report requests', () => {
  it('needs confirmed facts, then queues one report at a time with versions counting up', async () => {
    await expect(request(bob)).rejects.toThrow(/confirm the property/);
    await confirm();
    const first = await request(bob);
    await expect(request(alice)).rejects.toThrow(/already queued or running/);
    expect(await t.as(alice, () => t.rows('select version, status, target_price::text, budget::text, days_to_list from public.reports'))).toEqual([
      { version: 1, status: 'queued', target_price: '1450000', budget: '25000.00', days_to_list: 30 },
    ]);
    const [claimed] = await claim();
    expect(claimed).toMatchObject({ id: first, status: 'running', version: 1 });
    expect(await claim()).toEqual([]); // nothing else queued
    await expect(request(bob)).rejects.toThrow(/already queued or running/); // running counts too
    await t.service(() => t.rows(`update public.reports set status = 'done', output = '{"sections": {}}'::jsonb, narrative_source = 'llm', finished_at = now() where id = $1`, [first]));
    await request(alice, null, null, null);
    expect(await t.as(bob, () => t.rows('select version, status from public.reports order by version'))).toEqual([
      { version: 1, status: 'done' },
      { version: 2, status: 'queued' },
    ]);
  });

  it('is limited to the property team, and inputs are range-checked', async () => {
    await confirm();
    await expect(request(carol)).rejects.toThrow(/not a member/);
    await expect(request(bob, 5)).rejects.toThrow(); // a $5 target price
    await expect(request(bob, 900_000, -1)).rejects.toThrow();
    await expect(request(bob, 900_000, 1000, 900)).rejects.toThrow();
    await expect(t.as(null, () => t.rows('select public.request_report($1)', [home]))).rejects.toThrow();
  });

  it('a queued report can be cancelled by the team, a running one cannot', async () => {
    await confirm();
    const id = await request(bob);
    expect(await t.as(carol, () => one(t.rows<{ ok: boolean }>('select public.cancel_report($1) as ok', [id])))).toEqual({ ok: false });
    expect(await t.as(alice, () => one(t.rows<{ ok: boolean }>('select public.cancel_report($1) as ok', [id])))).toEqual({ ok: true });
    expect(await claim()).toEqual([]);
    await request(bob);
    const [running] = await claim();
    expect(await t.as(bob, () => one(t.rows<{ ok: boolean }>('select public.cancel_report($1) as ok', [running!.id])))).toEqual({ ok: false });
  });
});

describe('report visibility and writes', () => {
  it('members read their team reports; other teams and anon see nothing', async () => {
    await confirm();
    await request(bob);
    expect(await t.as(alice, () => t.rows('select id from public.reports'))).toHaveLength(1);
    expect(await t.as(carol, () => t.rows('select id from public.reports'))).toEqual([]);
    await expect(t.as(null, () => t.rows('select id from public.reports'))).rejects.toThrow();
  });

  it('only the service role writes reports; members cannot insert, edit or claim', async () => {
    await confirm();
    const id = await request(bob);
    await expect(t.as(bob, () => t.rows(`insert into public.reports (property_id, version) values ($1, 9)`, [home]))).rejects.toThrow();
    await expect(t.as(alice, () => t.rows(`update public.reports set output = '{}'::jsonb where id = $1`, [id]))).rejects.toThrow();
    await expect(t.as(alice, () => t.rows('delete from public.reports where id = $1', [id]))).rejects.toThrow();
    await expect(t.as(bob, () => t.rows('select * from public.claim_report_job()'))).rejects.toThrow();
  });

  it('deleting the property deletes its reports', async () => {
    await confirm();
    await request(bob);
    await t.as(alice, () => t.rows('delete from public.properties where id = $1', [home]));
    expect(await t.service(() => t.rows('select id from public.reports'))).toEqual([]);
  });
});
