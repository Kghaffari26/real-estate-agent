-- Listing Prep P3: per-property insights computed by the worker (value range, buyer
-- demand by need, nearby schools and amenities). SPEC_LISTING_PREP.md §5.1–§5.3, §5.6.
--
-- Numbers come from the worker's Python (agents/listing_prep/insights.py), never from
-- the site or a model; members read them, only the service role writes them. They are
-- recomputed when the facts are confirmed again, when findings are reviewed, or after
-- 30 days; editing the facts removes them (they described the old facts).

create table public.property_insights (
  property_id uuid primary key references public.properties (id) on delete cascade,
  valuation jsonb,          -- {low, mid, high, method, confidence, notes[], inputs{}}
  segments jsonb,           -- [{key, label, weight, priorities[], evidence[]}]
  schools jsonb,            -- [{name, level, grades, charter, miles}]
  amenities jsonb,          -- [{kind, count, nearest_miles}]
  amenities_point text,     -- the position they were fetched for ("lat,lon", 5 decimals)
  amenities_fetched_at timestamptz,  -- a property's amenities are reused for 30 days
  sources jsonb not null default '[]'::jsonb,  -- attributions and data dates
  notes jsonb not null default '[]'::jsonb,    -- what couldn't be computed, and why
  computed_at timestamptz not null default now()
);

alter table public.property_insights enable row level security;
create policy property_insights_read on public.property_insights for select to authenticated
  using (public.is_member(public.property_team(property_id)));

-- Editing confirmed facts clears the insights computed from them.
create function public.clear_insights_on_facts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.facts is distinct from old.facts then
    delete from public.property_insights where property_id = new.id;
  end if;
  return new;
end;
$$;
create trigger properties_clear_insights after update on public.properties
  for each row execute function public.clear_insights_on_facts();

-- The worker's queue: confirmed properties with no insights, or older than their facts'
-- confirmation, their latest finding review, or 30 days; and, hourly, pinned properties
-- whose amenities couldn't be fetched (OpenStreetMap's server was busy). It returns the
-- previous amenities so the worker can reuse them instead of asking again.
create function public.properties_needing_insights(max_rows int default 20)
returns table (id uuid, team_id uuid, facts jsonb, lat double precision, lon double precision, zip text, place_id text,
               prev_amenities jsonb, prev_amenities_point text, prev_amenities_fetched_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.team_id, p.facts, p.lat, p.lon, p.zip, p.place_id, i.amenities, i.amenities_point, i.amenities_fetched_at
  from public.properties p
  left join public.property_insights i on i.property_id = p.id
  where p.facts_confirmed_at is not null
    and (i.property_id is null
         or i.computed_at < p.facts_confirmed_at
         or i.computed_at < now() - interval '30 days'
         or i.computed_at < (select max(f.reviewed_at) from public.findings f where f.property_id = p.id)
         or (p.lat is not null and i.amenities is null and i.computed_at < now() - interval '1 hour'))
  order by p.facts_confirmed_at
  limit max_rows
$$;

revoke all on public.property_insights from anon, authenticated;
grant select on public.property_insights to authenticated;
grant all on public.property_insights, public.findings to service_role;

-- Worker-only (Supabase grants new functions to the API roles by default).
revoke all on function public.properties_needing_insights(int), public.clear_insights_on_facts()
  from public, anon, authenticated;
grant execute on function public.properties_needing_insights(int) to service_role;
