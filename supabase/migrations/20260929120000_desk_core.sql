-- Regional Desk R3: teams, members, invites, and the first team-owned tables.
--
-- Security model (SPEC_REGIONAL_DESK.md §4.3, R3):
--   * Row-level security on every table; `anon` gets nothing.
--   * A signed-in user sees only the teams they belong to and those teams' rows.
--   * Managers invite, change roles and remove members; agents work the team's rows.
--   * Teams are created and invites accepted only through the SECURITY DEFINER
--     functions below, which check the caller; there is no direct INSERT on teams or
--     team_members.
--   * A team always keeps at least one manager; nobody can promote themselves.
--   * Row ownership columns (team_id, created_by…) are not updatable (column grants).
-- `auth.uid()` / `auth.jwt()` are Supabase's; tests stub them (src/backend/*.test.ts).

create type public.team_role as enum ('manager', 'agent');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_role not null default 'agent',
  display_name text check (display_name is null or char_length(display_name) <= 120),
  email text,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role public.team_role not null default 'agent',
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  unique (team_id, email)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  address text not null check (char_length(btrim(address)) between 3 and 300),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  zip text,
  city text,
  facts jsonb not null default '{}'::jsonb,
  status text not null default 'watching' check (status in ('watching', 'preparing', 'listed', 'under_contract', 'sold', 'archived')),
  notes text,
  assignee uuid references auth.users (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_team_idx on public.properties (team_id);

create table public.favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

-- ---------- helpers (SECURITY DEFINER so policies don't recurse through team_members) ----------

create function public.is_member(team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = team and user_id = auth.uid())
$$;

create function public.is_manager(team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = team and user_id = auth.uid() and role = 'manager')
$$;

create function public.property_team(property uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.properties where id = property
$$;

-- ---------- invariants ----------

-- A team always keeps a manager; only managers change roles.
create function public.guard_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role <> old.role and not public.is_manager(old.team_id) then
    raise exception 'only a manager can change roles' using errcode = '42501';
  end if;
  if old.role = 'manager'
     and (tg_op = 'DELETE' or new.role <> 'manager')
     and exists (select 1 from public.teams where id = old.team_id)
     and not exists (select 1 from public.team_members where team_id = old.team_id and role = 'manager' and user_id <> old.user_id) then
    raise exception 'a team needs at least one manager' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger team_members_guard before update or delete on public.team_members
  for each row execute function public.guard_members();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();

-- ---------- row-level security ----------

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.invites enable row level security;
alter table public.properties enable row level security;
alter table public.favorites enable row level security;

create policy teams_read on public.teams for select to authenticated using (public.is_member(id));
create policy teams_rename on public.teams for update to authenticated using (public.is_manager(id)) with check (public.is_manager(id));

create policy members_read on public.team_members for select to authenticated using (public.is_member(team_id));
create policy members_update on public.team_members for update to authenticated
  using (public.is_manager(team_id) or user_id = auth.uid())
  with check (public.is_manager(team_id) or user_id = auth.uid());
create policy members_remove on public.team_members for delete to authenticated
  using (public.is_manager(team_id) or user_id = auth.uid());

create policy invites_read on public.invites for select to authenticated using (public.is_manager(team_id));
create policy invites_create on public.invites for insert to authenticated
  with check (public.is_manager(team_id) and invited_by = auth.uid());
create policy invites_revoke on public.invites for delete to authenticated using (public.is_manager(team_id));

create policy properties_read on public.properties for select to authenticated using (public.is_member(team_id));
create policy properties_create on public.properties for insert to authenticated
  with check (public.is_member(team_id) and created_by = auth.uid());
create policy properties_update on public.properties for update to authenticated
  using (public.is_member(team_id)) with check (public.is_member(team_id));
create policy properties_delete on public.properties for delete to authenticated
  using (public.is_manager(team_id) or created_by = auth.uid());

create policy favorites_own on public.favorites for all to authenticated
  using (user_id = auth.uid() and public.is_member(public.property_team(property_id)))
  with check (user_id = auth.uid() and public.is_member(public.property_team(property_id)));

-- ---------- functions the site calls ----------

-- Create a team; the caller becomes its first manager.
create function public.create_team(team_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  team uuid;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  insert into public.teams (name) values (btrim(team_name)) returning id into team;
  insert into public.team_members (team_id, user_id, role, email)
    values (team, me, 'manager', lower(auth.jwt() ->> 'email'));
  return team;
end;
$$;

-- Pending, unexpired invites addressed to the caller's email.
create function public.my_invites()
returns table (token uuid, team_id uuid, team_name text, role public.team_role, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.token, i.team_id, t.name, i.role, i.expires_at
  from public.invites i join public.teams t on t.id = i.team_id
  where auth.uid() is not null
    and i.email = lower(auth.jwt() ->> 'email')
    and i.accepted_at is null
    and i.expires_at > now()
$$;

-- Accept an invite addressed to the caller's email; returns the team.
create function public.accept_invite(invite_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  inv public.invites;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into inv from public.invites
    where token = invite_token and accepted_at is null and expires_at > now()
      and email = lower(auth.jwt() ->> 'email');
  if not found then
    raise exception 'no pending invite for this account' using errcode = 'P0002';
  end if;
  insert into public.team_members (team_id, user_id, role, email)
    values (inv.team_id, me, inv.role, inv.email)
    on conflict (team_id, user_id) do nothing;
  update public.invites set accepted_at = now() where id = inv.id;
  return inv.team_id;
end;
$$;

-- ---------- privileges: nothing for anon; the minimum for signed-in users ----------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;

grant select, update (name) on public.teams to authenticated;
grant select, delete, update (role, display_name) on public.team_members to authenticated;
grant select, insert (team_id, email, role, invited_by, expires_at), delete on public.invites to authenticated;
grant select, delete,
  insert (team_id, address, lat, lon, zip, city, facts, status, notes, assignee, created_by),
  update (address, lat, lon, zip, city, facts, status, notes, assignee)
  on public.properties to authenticated;
grant select, insert (property_id, user_id), delete on public.favorites to authenticated;

grant execute on function public.create_team(text), public.my_invites(), public.accept_invite(uuid),
  public.is_member(uuid), public.is_manager(uuid), public.property_team(uuid) to authenticated;
