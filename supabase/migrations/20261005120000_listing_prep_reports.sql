-- Listing Prep P5: report jobs and their output (SPEC_LISTING_PREP.md §6, §7, §8).
--
-- A member asks for a report (target price, preparation budget, days until listing) on a
-- property whose facts are confirmed; the worker claims it, runs the report agent
-- (agents/listing_prep/report.py) and writes the assembled report into `output`. Every
-- figure in it is computed by the worker; the narrative is number-guarded and
-- fair-housing screened before it's stored. Members read; only the service role writes
-- output. Versions count up per property; P6 adds locking and sharing.
--
-- The report's line items live inside `output` (sections.improvements.items) rather than
-- a separate report_items table (§8): they're written once, with the report, and read
-- with it (DECISIONS.md, P5).

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  version int not null check (version >= 1),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  target_price bigint check (target_price is null or target_price between 10000 and 1000000000),
  budget numeric(12, 2) check (budget is null or budget between 0 and 10000000),
  days_to_list int check (days_to_list is null or days_to_list between 0 and 365),
  output jsonb check (output is null or jsonb_typeof(output) = 'object'),
  narrative_source text check (narrative_source is null or narrative_source in ('llm', 'template')),
  prompt_version text,
  usd numeric(10, 4) not null default 0,
  error text check (error is null or error ~ '^[a-z_]{2,40}$'),
  requested_by uuid not null default auth.uid() references auth.users (id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (property_id, version)
);
create unique index reports_one_active on public.reports (property_id) where status in ('queued', 'running');

alter table public.reports enable row level security;
create policy reports_read on public.reports for select to authenticated
  using (public.is_member(public.property_team(property_id)));

-- Ask for a report. SECURITY DEFINER for the version count; membership and confirmed facts
-- are checked here, and the partial unique index allows one queued or running report per
-- property.
create function public.request_report(property uuid, target_price bigint default null, budget numeric default null, days_to_list int default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if auth.uid() is null or not public.is_member(public.property_team(property)) then
    raise exception 'not a member of this property''s team' using errcode = '42501';
  end if;
  if not public.facts_confirmed(property) then
    raise exception 'confirm the property''s facts first' using errcode = '22023';
  end if;
  if exists (select 1 from public.reports r where r.property_id = property and r.status in ('queued', 'running')) then
    raise exception 'a report for this property is already queued or running' using errcode = '23505';
  end if;
  insert into public.reports (property_id, version, target_price, budget, days_to_list, requested_by)
    values (property,
            coalesce((select max(r.version) from public.reports r where r.property_id = property), 0) + 1,
            target_price, budget, days_to_list, auth.uid())
    returning id into rid;
  return rid;
end;
$$;

-- A queued report can be cancelled by any member of the team.
create function public.cancel_report(report uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.reports r set status = 'cancelled', error = 'cancelled_by_agent', finished_at = now()
    where r.id = report and r.status = 'queued' and public.is_member(public.property_team(r.property_id));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- The worker claims the oldest queued report (one at a time, safely under concurrency).
create function public.claim_report_job() returns setof public.reports
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.reports set status = 'running', started_at = now()
    where id = (select id from public.reports where status = 'queued' order by requested_at for update skip locked limit 1)
    returning *;
end;
$$;

revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant all on public.reports to service_role;
grant select on public.value_priors, public.cost_book, public.quotes, public.property_insights, public.photos,
  public.photo_results, public.properties to service_role;

revoke all on function public.request_report(uuid, bigint, numeric, int), public.cancel_report(uuid), public.claim_report_job()
  from public, anon, authenticated;
grant execute on function public.request_report(uuid, bigint, numeric, int), public.cancel_report(uuid) to authenticated;
grant execute on function public.claim_report_job() to service_role;
