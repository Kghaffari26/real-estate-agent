/**
 * The Desk (v3 R3) against an in-memory fake of the Supabase APIs the page uses (auth
 * and PostgREST). The fake only stores and returns rows; the real access rules are
 * the database's and are proven in src/backend/rls.test.ts. Here: sign-in by email
 * link (and its return, both outcomes), creating a team, inviting and revoking,
 * accepting an invite, the last-manager message, the email rate limit, the unconfigured
 * state, and axe.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

const URL_ = 'https://desk.supabase.test';
const STORAGE = 'sb-desk-auth-token';
const ME = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com' };

interface State {
  teams: Array<{ id: string; name: string }>;
  members: Array<{ team_id: string; user_id: string; role: 'manager' | 'agent'; display_name: string | null; email: string }>;
  invites: Array<{ id: string; team_id: string; email: string; role: 'manager' | 'agent'; expires_at: string; accepted_at: string | null; created_at: string }>;
  myInvites: Array<{ token: string; team_id: string; team_name: string; role: 'manager' | 'agent'; expires_at: string }>;
  otp: string[];
  redirects: string[];
  /** When set, /auth/v1/otp answers with this instead of sending (e.g. Supabase's 429). */
  otpFailure?: { status: number; body: unknown };
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const eq = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '');
let n = 100;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function fakeBackend(page: Page, s: State) {
  await page.route('**/desk-config.json', (r) => json(r, { url: URL_, anonKey: 'test-anon-key' }));
  await page.route(`${URL_}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
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
    return json(route, { message: `fake backend: unhandled ${req.method()} ${path}` }, 501);
  });
}

function session() {
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

const signedIn = (page: Page) => page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE, JSON.stringify(session())] as const);
const newState = (): State => ({ teams: [], members: [], invites: [], myInvites: [], otp: [], redirects: [] });

const serious = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>) =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);

for (const theme of ['dark', 'light'] as const) {
  test(`the Desk signs in by email link, axe-clean (${theme})`, async ({ page, consoleErrors }) => {
    const s = newState();
    await fakeBackend(page, s);
    await page.addInitScript((t) => localStorage.setItem('re-theme', t), theme);
    await gotoView(page, '/desk');
    const form = page.getByTestId('desk-signin');
    await expect(form).toBeVisible();
    expect(serious((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
    await expectNoHorizontalScroll(page);
    await form.getByLabel('Work email').fill('  Alice@Example.com ');
    await form.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByTestId('desk-link-sent')).toContainText('alice@example.com');
    expect(s.otp).toEqual(['alice@example.com']);
    // PKCE adds ?code= before the hash, so the link lands on the Desk route directly.
    expect(s.redirects).toEqual([expect.stringMatching(/\/real-estate-agent\/#\/desk$/)]);
    expect(consoleErrors).toEqual([]);
  });
}

test('the email rate limit gets a clear message, not “check the address”', async ({ page }) => {
  const s = newState();
  s.otpFailure = { status: 429, body: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' } };
  await fakeBackend(page, s);
  await gotoView(page, '/desk');
  const form = page.getByTestId('desk-signin');
  await form.getByLabel('Work email').fill('alice@example.com');
  await form.getByRole('button', { name: 'Email me a sign-in link' }).click();
  const alert = page.getByTestId('desk-signin-error');
  await expect(alert).toHaveAttribute('data-kind', 'rate-limit');
  await expect(alert).toContainText('paused sending');
  await expect(page.getByTestId('desk-link-sent')).toHaveCount(0);
  // Once the limit lifts, the same form sends.
  s.otpFailure = undefined;
  await form.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByTestId('desk-link-sent')).toBeVisible();
});

test('a new manager creates a team, invites and revokes', async ({ page }) => {
  const s = newState();
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk');
  await expect(page.getByTestId('desk-email')).toHaveText(ME.email);
  await page.getByLabel('Team or brokerage name').fill('Coastline Realty');
  await page.getByRole('button', { name: 'Create team' }).click();
  const members = page.getByTestId('desk-members');
  await expect(members).toContainText('Coastline Realty · members');
  await expect(members.getByRole('row', { name: /alice@example.com/ })).toContainText('Manager');
  const invite = page.getByTestId('desk-invite');
  await invite.getByLabel('Their email').fill('Bob@Example.com');
  await invite.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByTestId('desk-pending')).toContainText('bob@example.com · agent');
  expect(s.invites.map((i) => i.email)).toEqual(['bob@example.com']);
  await page.getByTestId('desk-pending').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByTestId('desk-pending')).toHaveCount(0);
  expect(s.invites).toEqual([]);
});

test('the last manager can’t leave, and says why', async ({ page }) => {
  const s = newState();
  s.teams.push({ id: 't1', name: 'Coastline Realty' });
  s.members.push({ team_id: 't1', user_id: ME.id, role: 'manager', display_name: null, email: ME.email });
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk');
  await page.getByTestId('desk-members').getByRole('button', { name: 'Leave team' }).click();
  await expect(page.getByTestId('desk-error')).toHaveText('A team needs at least one manager. Make someone else a manager first.');
});

test('an invited agent accepts and lands in the team', async ({ page }) => {
  const s = newState();
  s.myInvites.push({ token: 'tok-1', team_id: 't9', team_name: 'Canyon Homes', role: 'agent', expires_at: '2026-10-13T00:00:00Z' });
  await fakeBackend(page, s);
  await signedIn(page);
  await gotoView(page, '/desk');
  const inv = page.getByTestId('desk-invitations');
  await expect(inv).toContainText('Join Canyon Homes as an agent');
  await inv.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('desk-members')).toContainText('Canyon Homes · members');
  await expect(page).toHaveURL(/[?&]team=t9/);
  await expect(page.getByTestId('desk-invite')).toHaveCount(0); // agents don't invite
});

test('the magic-link return lands on the Desk signed in, and strips the spent code', async ({ page }) => {
  const s = newState();
  await fakeBackend(page, s);
  // The PKCE verifier this browser stored when it asked for the link.
  await page.addInitScript((key) => localStorage.setItem(`${key}-code-verifier`, JSON.stringify('test-verifier')), STORAGE);
  await page.goto('./?code=fresh-code#/desk');
  await expect(page.getByTestId('desk-email')).toHaveText(ME.email);
  await expect(page).toHaveURL(/\/real-estate-agent\/#\/desk$/);
  expect(new URL(page.url()).search).toBe('');
});

test('a failed or stale magic link says so; an old link without the route still lands on the Desk', async ({ page }) => {
  const s = newState();
  await fakeBackend(page, s);
  // No verifier stored (opened on another device): the exchange fails, and the page says so.
  await page.goto('./?code=stale-code#/desk');
  await expect(page.getByTestId('desk-signin').getByRole('alert')).toContainText('didn’t work');
  await expect(page).toHaveURL(/#\/desk\?signin=failed$/);
  expect(new URL(page.url()).search).toBe('');
  // A link sent before the redirect carried the route: it still ends on the Desk, signed in.
  await page.addInitScript((key) => localStorage.setItem(`${key}-code-verifier`, JSON.stringify('test-verifier')), STORAGE);
  await page.goto('./?code=fresh-code');
  await expect(page.getByTestId('desk-email')).toHaveText(ME.email);
  await expect(page).toHaveURL(/#\/desk$/);
});

test('without a backend the Desk says so and nothing else changes', async ({ page, consoleErrors }) => {
  await page.route('**/desk-config.json', (r) => r.fulfill({ status: 404, body: '' }));
  await gotoView(page, '/desk');
  await expect(page.getByTestId('desk-off')).toBeVisible();
  if (test.info().project.name === 'desktop') await expect(page.getByRole('link', { name: 'Desk' }).first()).toBeAttached();
  expect(consoleErrors.filter((e) => !/desk-config\.json|404/.test(e))).toEqual([]);
});
