/**
 * The Desk (v3 R3): sign in with an email link, create or join a team, and manage it.
 * Everything here goes through the private backend (Supabase), whose row-level
 * security decides what each person can see and change; the page only reflects it.
 * Without the backend configured, the page says so and the rest of the site is unchanged.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { LogOut, Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { deskClient, signInRedirect } from '../backend/client';
import { deskApi, DeskError, isEmail, normalizeEmail, signInProblem, type Invite, type Member, type MyInvite, type Role, type SignInProblem, type Team } from '../backend/desk';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSetQuery } from '../hooks/useQueryState';
import { formatDate } from '../lib/format';
import { AtlasChrome } from '../ui/AtlasChrome';
import { Button, Segmented } from '../ui/controls';
import { GlassPanel } from '../ui/Glass';
import { CostBookPanel } from './desk/CostBookPanel';
import { PropertiesPanel } from './desk/PropertiesPanel';
import { ValuePriorsPanel } from './desk/ValuePriorsPanel';

type Load = { status: 'loading' } | { status: 'off' } | { status: 'ready'; client: SupabaseClient };

export function DeskPage() {
  useDocumentTitle('Desk');
  return (
    <DeskFrame
      heading="Your team’s workspace"
      intro="Private to your team: the homes you’re working, listing prep, and soon clients and calls. Market data stays public; everything here is visible only to your team’s members."
    >
      {(client, session) => <Workspace client={client} session={session} />}
    </DeskFrame>
  );
}

/**
 * The Desk's page frame: loads the backend config, then the sign-in, and renders `children`
 * with the client and session once someone is signed in. Every Desk route uses it.
 */
export function DeskFrame({
  heading,
  intro,
  eyebrow = 'The Desk',
  compact = false,
  children,
}: {
  heading: ReactNode;
  intro?: ReactNode;
  eyebrow?: ReactNode;
  /** A smaller heading (long addresses). */
  compact?: boolean;
  children: (client: SupabaseClient, session: Session) => ReactNode;
}) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    deskClient().then((client) => live && setLoad(client ? { status: 'ready', client } : { status: 'off' }));
    return () => {
      live = false;
    };
  }, []);
  return (
    <AtlasChrome>
      <div className="mx-auto max-w-[980px] px-4 pb-24 pt-6 sm:px-8">
        <div className="mp-label">{eyebrow}</div>
        <h1 className={`mp-display mt-2 ${compact ? 'text-[28px] leading-[1.1] sm:text-[38px]' : 'text-[40px] leading-[1.02] sm:text-[52px]'}`}>{heading}</h1>
        {intro && <p className="mt-3 max-w-2xl text-mp-ink-2">{intro}</p>}
        <div className="mt-8">
          {load.status === 'loading' ? (
            <p className="text-mp-ink-3" role="status">
              Loading…
            </p>
          ) : load.status === 'off' ? (
            <NotConfigured />
          ) : (
            <Signed client={load.client}>{children}</Signed>
          )}
        </div>
      </div>
    </AtlasChrome>
  );
}

export function Card({ title, icon, children, testId }: { title: string; icon?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <GlassPanel as="section" className="p-5 sm:p-6" aria-label={title} data-testid={testId}>
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-mp-ink">
        {icon}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </GlassPanel>
  );
}

function NotConfigured() {
  return (
    <Card title="The Desk isn’t set up on this site yet" icon={<ShieldCheck size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-off">
      <p className="text-sm text-mp-ink-2">
        It needs its private backend (sign-in and your team’s data). Once the site owner adds the backend’s address and public key, this page turns into your team’s workspace. The market atlas, dossiers and the Orange County view work without it.
      </p>
    </Card>
  );
}

function useSession(client: SupabaseClient) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);
  return session;
}

function Signed({ client, children }: { client: SupabaseClient; children: (client: SupabaseClient, session: Session) => ReactNode }) {
  const session = useSession(client);
  if (session === undefined) return <p className="text-mp-ink-3" role="status">Checking your sign-in…</p>;
  if (!session) return <SignIn client={client} />;
  return <>{children(client, session)}</>;
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) return;
    setState('sending');
    const { error } = await client.auth.signInWithOtp({ email: normalizeEmail(email), options: { emailRedirectTo: signInRedirect(), shouldCreateUser: true } });
    setProblem(error ? signInProblem(error) : null);
    setState(error ? 'error' : 'sent');
  };
  return (
    <Card title="Sign in" icon={<Mail size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-signin">
      {params.get('signin') === 'failed' && (
        <p role="alert" className="mb-3 text-sm text-mp-bad">
          That sign-in link didn’t work (it may have expired or been used). Send yourself a new one.
        </p>
      )}
      {state === 'sent' ? (
        <p role="status" className="text-sm text-mp-ink-2" data-testid="desk-link-sent">
          Check your email: we sent a sign-in link to <b className="text-mp-ink">{normalizeEmail(email)}</b>. Open it on this device.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
            Work email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink"
              placeholder="you@brokerage.com"
            />
          </label>
          <Button type="submit" disabled={!isEmail(email) || state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </Button>
          {state === 'error' && problem && (
            <p role="alert" className="w-full text-sm text-mp-bad" data-testid="desk-signin-error" data-kind={problem.kind}>
              {problem.message}
            </p>
          )}
          <p className="w-full text-xs text-mp-ink-3">No password: we email you a one-time link. New here? The link creates your account.</p>
        </form>
      )}
    </Card>
  );
}

function Workspace({ client, session }: { client: SupabaseClient; session: Session }) {
  const api = deskApi(client);
  const [params] = useSearchParams();
  const setQuery = useSetQuery();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const me = session.user;

  const refresh = useCallback(async () => {
    try {
      const [t, i] = await Promise.all([api.teams(), api.myInvites()]);
      setTeams(t);
      setInvites(i);
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
  };

  const current = teams?.find((t) => t.id === params.get('team')) ?? teams?.[0] ?? null;
  const tab = (['cost-book', 'team'] as const).find((t) => t === params.get('tab')) ?? 'properties';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-mp-ink-2">
        <span>
          Signed in as <b className="text-mp-ink" data-testid="desk-email">{me.email}</b>
        </span>
        <Button variant="quiet" icon={<LogOut size={15} strokeWidth={1.5} aria-hidden="true" />} onClick={() => client.auth.signOut()}>
          Sign out
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-mp-bad" data-testid="desk-error">
          {error}
        </p>
      )}
      {invites.length > 0 && (
        <Card title="Invitations" icon={<UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-invitations">
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.token} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  Join <b className="text-mp-ink">{i.team_name}</b> as {i.role === 'manager' ? 'a manager' : 'an agent'} <span className="text-mp-ink-3">(until {formatDate(i.expires_at)})</span>
                </span>
                <Button onClick={() => act(async () => setQuery({ team: await api.acceptInvite(i.token) }))}>Accept</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {teams === null ? (
        <p className="text-mp-ink-3" role="status">
          Loading your teams…
        </p>
      ) : teams.length === 0 ? (
        <CreateTeam onCreate={(name) => act(async () => setQuery({ team: await api.createTeam(name) }))} />
      ) : (
        current && (
          <>
            {teams.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-mp-ink-2">
                Team
                <select className="h-9 rounded-control border border-mp-line bg-mp-panel px-2 text-mp-ink" value={current.id} onChange={(e) => setQuery({ team: e.target.value })}>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Segmented
              label="Section"
              value={tab}
              onChange={(v) => setQuery({ tab: v === 'properties' ? null : v })}
              options={[
                { value: 'properties', label: 'Properties' },
                { value: 'cost-book', label: 'Cost book' },
                { value: 'team', label: 'Team' },
              ]}
            />
            {tab === 'properties' ? (
              <PropertiesPanel key={current.id} client={client} team={current} me={me.id} />
            ) : tab === 'cost-book' ? (
              <div className="space-y-6">
                <CostBookPanel key={current.id} client={client} team={current} me={me.id} />
                <ValuePriorsPanel key={`${current.id}-priors`} client={client} team={current} me={me.id} />
              </div>
            ) : (
              <TeamPanel key={current.id} client={client} team={current} me={me.id} onChanged={refresh} onError={setError} />
            )}
          </>
        )
      )}
    </div>
  );
}

function CreateTeam({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Card title="Create your team" icon={<Users size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-create-team">
      <p className="mb-3 text-sm text-mp-ink-2">You’ll be its manager and can invite your agents. Joining someone else’s team? Ask its manager to invite this email.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name);
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
          Team or brokerage name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required className="h-11 rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink" />
        </label>
        <Button type="submit" disabled={!name.trim()}>
          Create team
        </Button>
      </form>
    </Card>
  );
}

function TeamPanel({ client, team, me, onChanged, onError }: { client: SupabaseClient; team: Team; me: string; onChanged: () => void; onError: (m: string | null) => void }) {
  const api = deskApi(client);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const manager = members?.some((m) => m.user_id === me && m.role === 'manager') ?? false;

  const load = useCallback(async () => {
    try {
      const m = await api.members(team.id);
      setMembers(m);
      setPending(m.some((x) => x.user_id === me && x.role === 'manager') ? await api.invites(team.id) : []);
    } catch (e) {
      onError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, team.id, me]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    onError(null);
    try {
      await fn();
      after?.();
      await load();
      onChanged();
    } catch (e) {
      onError(e instanceof DeskError ? e.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <div className="space-y-6">
      <Card title={`${team.name} · members`} icon={<Users size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-members">
        {members === null ? (
          <p className="text-sm text-mp-ink-3" role="status">
            Loading…
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Team members and their roles</caption>
            <thead className="text-left text-[11px] uppercase tracking-[.06em] text-mp-ink-3">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Member
                </th>
                <th scope="col" className="py-2 font-medium">
                  Role
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.user_id === me;
                return (
                  <tr key={m.user_id} className="border-t border-mp-line">
                    <th scope="row" className="py-2 text-left font-normal text-mp-ink">
                      {m.display_name ?? m.email ?? 'Member'}
                      {self && <span className="ml-1 text-mp-ink-3">(you)</span>}
                    </th>
                    <td className="py-2 text-mp-ink-2">{m.role === 'manager' ? 'Manager' : 'Agent'}</td>
                    <td className="py-2 text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {manager && !self && (
                          <Button variant="quiet" onClick={() => act(() => api.setRole(team.id, m.user_id, m.role === 'manager' ? 'agent' : 'manager'))}>
                            {m.role === 'manager' ? 'Make agent' : 'Make manager'}
                          </Button>
                        )}
                        {(manager || self) && (
                          <Button variant="quiet" onClick={() => act(() => api.removeMember(team.id, m.user_id))}>
                            {self ? 'Leave team' : 'Remove'}
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {manager && (
        <Card title="Invite someone" icon={<UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />} testId="desk-invite">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isEmail(email)) act(() => api.invite(team.id, email, role, me), () => setEmail(''));
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-sm text-mp-ink-2">
              Their email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-control border border-mp-line bg-mp-panel px-3 text-mp-ink" />
            </label>
            <Segmented
              label="Role"
              value={role}
              onChange={setRole}
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'manager', label: 'Manager' },
              ]}
            />
            <Button type="submit" disabled={!isEmail(email)}>
              Invite
            </Button>
          </form>
          <p className="mt-2 text-xs text-mp-ink-3">They sign in here with that email and accept. Invites last 14 days.</p>
          {pending.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-mp-line pt-3 text-sm" data-testid="desk-pending">
              {pending.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3">
                  <span className="text-mp-ink-2">
                    {i.email} · {i.role === 'manager' ? 'manager' : 'agent'} <span className="text-mp-ink-3">(until {formatDate(i.expires_at)})</span>
                  </span>
                  <Button variant="quiet" onClick={() => act(() => api.revokeInvite(i.id))}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
