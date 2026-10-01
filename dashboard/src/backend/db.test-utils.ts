/**
 * Test harness for the backend's migrations, on one of two databases:
 *
 * - **PGlite** (default; local and every CI run): a real Postgres compiled to
 *   WebAssembly, with a stand-in for Supabase's `auth` schema (users, `auth.uid()`,
 *   `auth.jwt()` reading `request.jwt.claims` as Supabase's do) and its roles, then every
 *   file in `supabase/migrations/` in order. Fast, no Docker.
 * - **The real local Supabase stack** when `DESK_TEST_DATABASE_URL` is set (the
 *   `desk-db` CI job runs `supabase start`, which applies the migrations to Supabase's own
 *   Postgres image with its real `auth` schema, roles and default privileges). Each test
 *   runs in a transaction that is rolled back, so nothing persists between tests.
 *
 * `as(user)` switches to that signed-in user the way PostgREST does (SET ROLE plus the
 * JWT claims), so row-level security is enforced for real on both.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../../supabase/migrations');
export const REAL_DATABASE_URL = process.env.DESK_TEST_DATABASE_URL ?? '';

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, aud text, role text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''), '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

export interface User {
  id: string;
  email: string;
}

interface Conn {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

async function pglite(): Promise<Conn> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  }
  return { query: (sql, params) => db.query(sql, params as never[]), exec: (sql) => db.exec(sql), close: () => db.close() };
}

async function realSupabase(): Promise<Conn> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: REAL_DATABASE_URL });
  await client.connect();
  await client.query('begin');
  return {
    query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows }),
    exec: (sql) => client.query(sql),
    close: async () => {
      await client.query('rollback').catch(() => undefined);
      await client.end();
    },
  };
}

export async function freshDb() {
  const real = Boolean(REAL_DATABASE_URL);
  const conn = real ? await realSupabase() : await pglite();
  let n = 0;
  const run = `${Date.now().toString(16).slice(-6)}${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`;
  const user = async (email: string): Promise<User> => {
    const id = `00000000-0000-4000-8000-${(run + String(++n).padStart(2, '0')).slice(-12).padStart(12, '0')}`;
    await conn.query(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`, [id, email]);
    return { id, email };
  };
  /**
   * Run `fn` as `u` (signed in) or as `anon` (null), then return to the owner role. On the
   * real stack a failing statement aborts the transaction, so each call runs inside a
   * savepoint that is released on success and rolled back on failure.
   */
  const as = async <T>(u: User | null, fn: () => Promise<T>): Promise<T> => {
    const claims = u ? JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated' }) : '';
    if (real) await conn.exec('savepoint as_user');
    await conn.exec(`set role ${u ? 'authenticated' : 'anon'}`);
    await conn.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
    try {
      const out = await fn();
      if (real) await conn.exec('reset role; release savepoint as_user');
      return out;
    } catch (e) {
      if (real) await conn.exec('rollback to savepoint as_user; release savepoint as_user');
      throw e;
    } finally {
      await conn.exec(`reset role`);
      await conn.query(`select set_config('request.jwt.claims', '', false)`);
    }
  };
  /** As the owner (the migrations' role): service-level actions outside RLS. */
  const admin = async (sql: string) => {
    if (real) await conn.exec('savepoint admin');
    try {
      await conn.exec(sql);
      if (real) await conn.exec('release savepoint admin');
    } catch (e) {
      if (real) await conn.exec('rollback to savepoint admin; release savepoint admin');
      throw e;
    }
  };
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await conn.query<T>(sql, params)).rows;
  return { real, user, as, rows, admin, close: () => conn.close() };
}
