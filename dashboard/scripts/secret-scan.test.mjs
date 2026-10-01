import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDeskConfig, scanText } from './secret-scan.mjs';

// Unsigned, made-up tokens with the shapes Supabase uses (test values only).
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJlLW5vdC1yZWFs`;
const ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon', iat: 1, exp: 2 });
const SERVICE = jwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'service_role', iat: 1, exp: 2 });

describe('secret scan', () => {
  it('flags a service-role JWT and sb_secret_ keys anywhere in a text, but not the anon key', () => {
    expect(scanText(`const a="${ANON}";`)).toEqual([]);
    expect(scanText(`x;const k="${SERVICE}";y`)).toEqual([{ kind: 'service-role JWT', detail: expect.stringMatching(/role=service_role/) }]);
    expect(scanText('key: sb_secret_abcdefghijklmnop123')).toEqual([{ kind: 'Supabase secret key', detail: expect.stringMatching(/^sb_secret_abcd/) }]);
    expect(scanText('eyJhbGciOi.notjson.x')).toEqual([]);
  });

  it('accepts only { url, anonKey } with an https URL and a public key in desk-config.json', () => {
    expect(checkDeskConfig({ url: 'https://abc.supabase.co', anonKey: ANON })).toEqual([]);
    expect(checkDeskConfig({ url: 'https://abc.supabase.co', anonKey: 'sb_publishable_abc123' })).toEqual([]);
    expect(checkDeskConfig({ url: 'https://abc.supabase.co', anonKey: SERVICE })).toEqual(['anonKey has role=service_role; only the anon key may be published']);
    expect(checkDeskConfig({ url: 'https://abc.supabase.co', anonKey: 'sb_secret_abcdefghijk' })[0]).toMatch(/secret key/);
    expect(checkDeskConfig({ url: 'https://abc.supabase.co', anonKey: ANON, serviceKey: 'x' })[0]).toMatch(/unexpected keys: serviceKey/);
    expect(checkDeskConfig({ url: 'http://abc.supabase.co', anonKey: ANON })).toEqual(['url must be an https URL']);
    expect(checkDeskConfig({ url: 'http://127.0.0.1:54321', anonKey: ANON })).toEqual([]);
    expect(checkDeskConfig({ url: 'http://localhost.evil.com', anonKey: ANON })).toEqual(['url must be an https URL']);
    expect(checkDeskConfig([])).toEqual(['not a JSON object']);
  });
});

describe('check-secrets.mjs on a built site', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const run = (env = {}) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [resolve(__dirname, 'check-secrets.mjs'), dir], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe' }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const site = (files) => {
    dir = mkdtempSync(join(tmpdir(), 'dist-'));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
  };

  it('passes a clean build and fails on a leaked key, a bad config or the service key’s literal value', () => {
    site({ 'index.html': '<html></html>', 'assets/app.js': `const k="${ANON}"`, 'desk-config.json': JSON.stringify({ url: 'https://abc.supabase.co', anonKey: ANON }) });
    expect(run().code).toBe(0);
    writeFileSync(join(dir, 'assets/leak.js'), `const s="${SERVICE}"`);
    expect(run()).toMatchObject({ code: 1, out: expect.stringMatching(/service-role JWT/) });
    rmSync(join(dir, 'assets/leak.js'));
    writeFileSync(join(dir, 'desk-config.json'), JSON.stringify({ url: 'https://abc.supabase.co', anonKey: ANON, serviceRoleKey: SERVICE }));
    expect(run()).toMatchObject({ code: 1, out: expect.stringMatching(/unexpected keys/) });
    writeFileSync(join(dir, 'desk-config.json'), JSON.stringify({ url: 'https://abc.supabase.co', anonKey: ANON }));
    writeFileSync(join(dir, 'assets/other.js'), 'const s="super-secret-opaque-value"');
    expect(run({ SUPABASE_SERVICE_ROLE_KEY: 'super-secret-opaque-value' })).toMatchObject({ code: 1, out: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY value/) });
  }, 30_000); // four node subprocesses; slow when the whole suite runs in parallel
});
