/**
 * The Desk (v3 R3) against an in-memory fake of the Supabase APIs the page uses (auth
 * and PostgREST). The fake only stores and returns rows; the real access rules are
 * the database's and are proven in src/backend/rls.test.ts. Here: sign-in by email
 * link (and its return, both outcomes), creating a team, inviting and revoking,
 * accepting an invite, the last-manager message, the email rate limit, the unconfigured
 * state, and axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { fakeBackend, ME, newState, signedIn, STORAGE } from './fakeSupabase';
import { expect, expectNoHorizontalScroll, gotoView, test } from './fixtures';

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
  // A new team opens on its (empty) properties; the team itself is a section away.
  await expect(page.getByTestId('desk-properties')).toContainText('No properties yet');
  await page.getByRole('radio', { name: 'Team' }).check({ force: true });
  await expect(page).toHaveURL(/[?&]tab=team/);
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
  await gotoView(page, '/desk?tab=team');
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
  await expect(page.getByTestId('desk-properties')).toContainText('Canyon Homes · properties');
  await page.getByRole('radio', { name: 'Team' }).check({ force: true });
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
