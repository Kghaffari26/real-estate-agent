/**
 * The Desk's data calls (R3): the signed-in user's teams, members and invites. Thin,
 * typed wrappers over the Supabase client; the rules live in the database
 * (`supabase/migrations/*`, proven in `rls.test.ts`), so these never re-check access.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'manager' | 'agent';

export interface Team {
  id: string;
  name: string;
}
export interface Member {
  team_id: string;
  user_id: string;
  role: Role;
  display_name: string | null;
  email: string | null;
}
export interface Invite {
  id: string;
  team_id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
}
export interface MyInvite {
  token: string;
  team_id: string;
  team_name: string;
  role: Role;
  expires_at: string;
}

export class DeskError extends Error {}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new DeskError(friendly(res.error.message));
  return res.data as T;
}

/** Database messages people can act on; the rest become a generic line. */
export function friendly(message: string): string {
  if (/at least one manager/.test(message)) return 'A team needs at least one manager. Make someone else a manager first.';
  if (/no pending invite/.test(message)) return 'That invite is no longer valid for this account. Ask a manager for a new one.';
  if (/duplicate key.*invites/.test(message)) return 'That email already has an invite for this team.';
  if (/only a manager/.test(message)) return 'Only a manager can change roles.';
  if (/row-level security|permission denied/.test(message)) return 'You don’t have access to do that.';
  return 'Something went wrong. Try again.';
}

/** The error fields Supabase auth returns (AuthApiError: HTTP status, error code, message). */
export interface AuthFailure {
  status?: number;
  code?: string;
  message: string;
}

export type SignInProblem = { kind: 'rate-limit' | 'invalid' | 'other'; message: string };

/**
 * Why a sign-in link wasn't sent, in words people can act on. Supabase answers 429 when
 * the project's email cap is reached (the built-in sender allows only a few an hour) or
 * the same address asked again too soon; neither is fixed by retrying right away.
 */
export function signInProblem(error: AuthFailure): SignInProblem {
  const wait = /after (\d+) seconds?/.exec(error.message)?.[1];
  if (wait) return { kind: 'rate-limit', message: `A link was just sent to this address. Wait ${wait} seconds, then ask for another (or use the one in your inbox).` };
  if (error.status === 429 || /^over_(email_send|request|sms_send)_rate_limit$/.test(error.code ?? '') || /rate limit/i.test(error.message)) {
    return {
      kind: 'rate-limit',
      message: 'Too many sign-in emails were sent in the last hour, so the Desk has paused sending. Use a link you already received, or try again later. If this keeps happening, your admin can raise the limit by connecting the team’s own email service (docs/DESK_SETUP.md).',
    };
  }
  if (error.status === 400 && /email/i.test(`${error.code ?? ''} ${error.message}`)) return { kind: 'invalid', message: 'That email address wasn’t accepted. Check it and try again.' };
  return { kind: 'other', message: 'We couldn’t send the link. Check the address and try again.' };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

export function deskApi(c: SupabaseClient) {
  return {
    async teams(): Promise<Team[]> {
      return check(await c.from('teams').select('id, name').order('name'));
    },
    async createTeam(name: string): Promise<string> {
      return check(await c.rpc('create_team', { team_name: name.trim() })) as string;
    },
    async myInvites(): Promise<MyInvite[]> {
      return check(await c.rpc('my_invites'));
    },
    async acceptInvite(token: string): Promise<string> {
      return check(await c.rpc('accept_invite', { invite_token: token })) as string;
    },
    async members(team: string): Promise<Member[]> {
      return check(await c.from('team_members').select('team_id, user_id, role, display_name, email').eq('team_id', team).order('email'));
    },
    async invites(team: string): Promise<Invite[]> {
      return check(await c.from('invites').select('id, team_id, email, role, expires_at, accepted_at').eq('team_id', team).is('accepted_at', null).order('created_at'));
    },
    async invite(team: string, email: string, role: Role, invitedBy: string): Promise<void> {
      check(await c.from('invites').insert({ team_id: team, email: normalizeEmail(email), role, invited_by: invitedBy }));
    },
    async revokeInvite(id: string): Promise<void> {
      check(await c.from('invites').delete().eq('id', id));
    },
    async setRole(team: string, user: string, role: Role): Promise<void> {
      check(await c.from('team_members').update({ role }).eq('team_id', team).eq('user_id', user));
    },
    async removeMember(team: string, user: string): Promise<void> {
      check(await c.from('team_members').delete().eq('team_id', team).eq('user_id', user));
    },
  };
}
