-- Listing Prep P4: the team's value priors (SPEC_LISTING_PREP.md §5.1, §5.4).
--
-- For each improvement item, the share of its cost a team expects to recover at resale
-- (value added ÷ cost), as a low–high range, with the source the team relies on. It's the
-- team's table, like the cost book: industry cost-vs-value reports can't be embedded in
-- software without a license (DECISIONS.md, P4), so nothing is pre-filled. Every row must
-- name its source. Managers write; members read; an item without a prior is "not enough
-- evidence" in the analysis, never a guess.

create table public.value_priors (
  team_id uuid not null references public.teams (id) on delete cascade,
  item text not null check (item ~ '^[a-z0-9_]{2,60}$'),
  recovery_low numeric(6, 3) not null check (recovery_low >= 0 and recovery_low <= 10),
  recovery_high numeric(6, 3) not null check (recovery_high <= 10),
  source text not null check (char_length(btrim(source)) between 2 and 300),
  notes text check (notes is null or char_length(notes) <= 500),
  updated_by uuid not null default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (team_id, item),
  check (recovery_high >= recovery_low)
);
create trigger value_priors_touch before update on public.value_priors
  for each row execute function public.touch_updated_at();

alter table public.value_priors enable row level security;
create policy value_priors_read on public.value_priors for select to authenticated using (public.is_member(team_id));
create policy value_priors_add on public.value_priors for insert to authenticated
  with check (public.is_manager(team_id) and updated_by = auth.uid());
create policy value_priors_edit on public.value_priors for update to authenticated
  using (public.is_manager(team_id)) with check (public.is_manager(team_id) and updated_by = auth.uid());
create policy value_priors_remove on public.value_priors for delete to authenticated using (public.is_manager(team_id));

-- Import or edit by item (an upsert through PostgREST would SET team_id and item).
-- SECURITY INVOKER: the policies above decide.
create function public.save_value_priors(team uuid, rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  insert into public.value_priors (team_id, item, recovery_low, recovery_high, source, notes, updated_by)
    select team, r.item, r.recovery_low, r.recovery_high, r.source, r.notes, auth.uid()
    from jsonb_to_recordset(rows) as r(item text, recovery_low numeric, recovery_high numeric, source text, notes text)
  on conflict (team_id, item) do update
    set recovery_low = excluded.recovery_low, recovery_high = excluded.recovery_high, source = excluded.source,
        notes = excluded.notes, updated_by = excluded.updated_by;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on public.value_priors from anon, authenticated;
grant select, delete, insert (team_id, item, recovery_low, recovery_high, source, notes, updated_by),
  update (recovery_low, recovery_high, source, notes, updated_by)
  on public.value_priors to authenticated;
grant all on public.value_priors to service_role;
revoke all on function public.save_value_priors(uuid, jsonb) from public, anon;
grant execute on function public.save_value_priors(uuid, jsonb) to authenticated;
