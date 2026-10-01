-- Listing Prep P2 groundwork: consent enforced at processing time, photo deletion and
-- retention, vision jobs and findings, and the geocode function's rate limit and cache.
-- SPEC_LISTING_PREP.md §3 (privacy, fair housing), §4 step 3, §8; owner review 2026-10-01.
--
--   * No active consent → the property's photos are hidden (rows and files), its
--     findings are marked withdrawn, its queued or running vision jobs are cancelled,
--     and the database refuses new findings (the worker checks too, per photo).
--   * Every deleted photo row (directly, or by deleting its property) queues its file
--     for deletion through the Storage API by the worker; orphaned files and photos past
--     retention (365 days, or 30 days after consent is revoked) are purged the same way.
--   * Findings are written only by the worker (service role); agents confirm, edit or
--     reject them. Nobody but the system marks a finding withdrawn, and a withdrawn
--     finding stays withdrawn (analysis has to run again under a new consent).

-- ---------- consent for processing: an active consent under a text that discloses it ----------

-- Consent text 2026-10 didn't disclose AI processing by a third-party provider or photo
-- retention; 2026-10b does (docs/legal/CONSENT_DRAFT.md). Photos show under any active
-- consent, but only a consent under a listed version lets them be analyzed.
create function public.processing_consent(property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seller_consents
                 where property_id = property and revoked_at is null and consent_version = any (array['2026-10b']))
$$;

-- ---------- photos: visible only with an active consent ----------

drop policy photos_read on public.photos;
create policy photos_read on public.photos for select to authenticated
  using (public.is_member(public.property_team(property_id)) and public.has_photo_consent(property_id));
drop policy photos_relabel on public.photos;
create policy photos_relabel on public.photos for update to authenticated
  using (public.is_member(public.property_team(property_id)) and public.has_photo_consent(property_id))
  with check (public.is_member(public.property_team(property_id)));

drop policy property_photos_read on storage.objects;
create policy property_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and public.photo_path_ok(name)
         and public.is_member(((storage.foldername(name))[1])::uuid)
         and public.has_photo_consent(((storage.foldername(name))[2])::uuid));

-- ---------- storage deletions (processed by the worker through the Storage API) ----------

create table public.storage_deletions (
  id bigint generated always as identity primary key,
  bucket text not null,
  path text not null,
  reason text not null check (reason in ('photo_deleted', 'orphan', 'retention', 'metadata')),
  requested_at timestamptz not null default now()
);

create function public.queue_photo_deletion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.storage_deletions (bucket, path, reason) values ('property-photos', old.storage_path, 'photo_deleted');
  return old;
end;
$$;
create trigger photos_queue_deletion after delete on public.photos
  for each row execute function public.queue_photo_deletion();

-- A manager can delete every photo of a property (e.g. the seller asks), even while
-- they are hidden because consent was revoked. The files follow via the queue.
create function public.purge_property_photos(property uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.is_manager(public.property_team(property)) then
    raise exception 'only a manager can delete all photos' using errcode = '42501';
  end if;
  delete from public.photos where property_id = property;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Retention: photos older than a year, or whose property has had no active consent for
-- 30 days (since the last revocation). Deleting the rows queues the files.
create function public.expire_photos(keep_days int default 365, revoked_days int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.photos p
  where p.created_at < now() - make_interval(days => keep_days)
     or (not public.has_photo_consent(p.property_id)
         and coalesce((select max(revoked_at) from public.seller_consents c where c.property_id = p.property_id), p.created_at)
             < now() - make_interval(days => revoked_days));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Files in the bucket with no photo row (an upload whose row insert failed), after a day.
create function public.queue_orphan_photos() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into public.storage_deletions (bucket, path, reason)
    select o.bucket_id, o.name, 'orphan' from storage.objects o
    where o.bucket_id = 'property-photos' and o.created_at < now() - interval '1 day'
      and not exists (select 1 from public.photos p where p.storage_path = o.name)
      and not exists (select 1 from public.storage_deletions d where d.path = o.name);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- vision jobs ----------

create table public.vision_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  requested_by uuid not null default auth.uid() references auth.users (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  photos_total int check (photos_total >= 0),
  photos_done int not null default 0 check (photos_done >= 0),
  error text check (error is null or error ~ '^[a-z_]{2,40}$'),
  usd numeric(10, 4) not null default 0,
  prompt_version text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index vision_jobs_one_active on public.vision_jobs (property_id) where status in ('queued', 'running');

create function public.facts_confirmed(property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.properties where id = property and facts_confirmed_at is not null)
$$;

-- The worker claims the oldest queued job (one at a time, safely under concurrency).
create function public.claim_vision_job() returns setof public.vision_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.vision_jobs set status = 'running', started_at = now()
    where id = (select id from public.vision_jobs where status = 'queued' order by created_at for update skip locked limit 1)
    returning *;
end;
$$;

-- ---------- per-photo outcomes and findings ----------

create table public.photo_results (
  photo_id uuid primary key references public.photos (id) on delete cascade,
  job_id uuid references public.vision_jobs (id) on delete set null,
  outcome text not null check (outcome in ('analyzed', 'skipped_people', 'skipped_unusable', 'rejected_metadata')),
  note text check (note is null or char_length(note) <= 300),
  prompt_version text,
  analyzed_at timestamptz not null default now()
);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  photo_id uuid references public.photos (id) on delete set null,
  job_id uuid references public.vision_jobs (id) on delete set null,
  room text not null,
  category text not null check (category in (
    'paint', 'walls_ceilings', 'flooring', 'lighting', 'fixtures_hardware', 'cabinets', 'countertops',
    'appliances', 'windows_doors', 'storage', 'bath', 'landscaping', 'exterior', 'roof_gutters',
    'curb_appeal', 'decluttering', 'cleaning', 'repair', 'staging', 'other')),
  condition smallint not null check (condition between 1 and 5),
  issue text not null check (char_length(issue) between 3 and 300),
  suggested_fix text check (suggested_fix is null or char_length(suggested_fix) <= 300),
  fix_item text check (fix_item is null or fix_item ~ '^[a-z0-9_]{2,60}$'),
  quantity numeric(10, 2) check (quantity is null or quantity >= 0),
  severity text not null default 'cosmetic' check (severity in ('cosmetic', 'minor_repair', 'major_repair')),
  -- the evidence crop: a box in the photo, as fractions of its width and height
  evidence jsonb check (evidence is null or (
    jsonb_typeof(evidence) = 'object'
    and (evidence ->> 'x')::numeric between 0 and 1 and (evidence ->> 'y')::numeric between 0 and 1
    and (evidence ->> 'w')::numeric between 0 and 1 and (evidence ->> 'h')::numeric between 0 and 1)),
  model_confidence text check (model_confidence in ('high', 'medium', 'low')),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'edited', 'rejected', 'withdrawn')),
  agent_note text check (agent_note is null or char_length(agent_note) <= 500),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  prompt_version text,
  created_at timestamptz not null default now()
);
create index findings_property_idx on public.findings (property_id);

create function public.guard_findings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.processing_consent(new.property_id) then
      raise exception 'consent revoked' using errcode = '42501';
    end if;
    if new.status <> 'proposed' then
      raise exception 'new findings start as proposed' using errcode = '23514';
    end if;
    return new;
  end if;
  -- photo_id / job_id may still be cleared (their photo or job deleted: ON DELETE SET NULL).
  if old.status = 'withdrawn' and (to_jsonb(new) - 'photo_id' - 'job_id') is distinct from (to_jsonb(old) - 'photo_id' - 'job_id') then
    raise exception 'a withdrawn finding can’t change; run the analysis again' using errcode = '42501';
  end if;
  if new.status = 'withdrawn' and old.status <> 'withdrawn' and public.has_photo_consent(new.property_id) then
    raise exception 'only a consent revocation withdraws findings' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and auth.uid() is not null then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger findings_guard before insert or update on public.findings
  for each row execute function public.guard_findings();

-- Results are written only under a processing consent too (the worker may race a revocation).
create function public.guard_photo_results() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.processing_consent((select property_id from public.photos where id = new.photo_id)) then
    raise exception 'consent revoked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger photo_results_guard before insert or update on public.photo_results
  for each row execute function public.guard_photo_results();

create function public.photo_property(photo uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select property_id from public.photos where id = photo
$$;

-- ---------- consent revoked → withdraw findings, cancel jobs ----------

create function public.consent_revoked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and not public.has_photo_consent(new.property_id) then
    update public.findings set status = 'withdrawn' where property_id = new.property_id and status <> 'withdrawn';
    update public.vision_jobs set status = 'cancelled', error = 'consent_revoked', finished_at = now()
      where property_id = new.property_id and status in ('queued', 'running');
    -- So a later consent and a new job analyze every photo again.
    delete from public.photo_results where photo_id in (select id from public.photos where property_id = new.property_id);
  end if;
  return new;
end;
$$;
create trigger seller_consents_revoked after update on public.seller_consents
  for each row execute function public.consent_revoked();

-- ---------- the geocode function's rate limit and cache ----------

create table public.geocode_cache (
  key text primary key check (char_length(key) between 6 and 200),
  matches jsonb not null check (jsonb_typeof(matches) = 'array' and jsonb_array_length(matches) <= 5),
  fetched_at timestamptz not null default now()
);

create table public.geocode_hits (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index geocode_hits_user_at on public.geocode_hits (user_id, at);

-- Called by the geocode function as the signed-in user: counts the request against
-- their limits (20 a minute, 300 a day) and returns a fresh cached answer if there is
-- one (90 days; 7 for "no match"). Only the function, with its service key, writes the cache.
create function public.geocode_gate(address_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  per_minute int;
  per_day int;
  cached jsonb;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  delete from public.geocode_hits where user_id = me and at < now() - interval '1 day';
  select count(*) filter (where at > now() - interval '1 minute'), count(*) into per_minute, per_day
    from public.geocode_hits where user_id = me;
  if per_minute >= 20 or per_day >= 300 then
    return jsonb_build_object('allowed', false, 'retry_after', case when per_minute >= 20 then 60 else 3600 end);
  end if;
  insert into public.geocode_hits (user_id) values (me);
  select matches into cached from public.geocode_cache
    where key = address_key
      and fetched_at > now() - case when jsonb_array_length(matches) = 0 then interval '7 days' else interval '90 days' end;
  return jsonb_build_object('allowed', true, 'cached', cached);
end;
$$;

create function public.geocode_store(address_key text, result jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.geocode_cache (key, matches) values (address_key, result)
    on conflict (key) do update set matches = excluded.matches, fetched_at = now()
$$;

-- ---------- row-level security ----------

alter table public.storage_deletions enable row level security; -- no policies: the worker only
alter table public.vision_jobs enable row level security;
alter table public.photo_results enable row level security;
alter table public.findings enable row level security;
alter table public.geocode_cache enable row level security;      -- no policies: functions only
alter table public.geocode_hits enable row level security;       -- no policies: functions only

create policy vision_jobs_read on public.vision_jobs for select to authenticated
  using (public.is_member(public.property_team(property_id)));
create policy vision_jobs_request on public.vision_jobs for insert to authenticated
  with check (public.is_member(public.property_team(property_id)) and requested_by = auth.uid()
              and public.processing_consent(property_id) and public.facts_confirmed(property_id));

create policy photo_results_read on public.photo_results for select to authenticated
  using (public.is_member(public.property_team(public.photo_property(photo_id)))
         and public.has_photo_consent(public.photo_property(photo_id)));

create policy findings_read on public.findings for select to authenticated
  using (public.is_member(public.property_team(property_id)));
create policy findings_review on public.findings for update to authenticated
  using (public.is_member(public.property_team(property_id)))
  with check (public.is_member(public.property_team(property_id)));

-- ---------- privileges ----------

revoke all on public.storage_deletions, public.vision_jobs, public.photo_results, public.findings,
  public.geocode_cache, public.geocode_hits from anon, authenticated;
-- Supabase's default privileges grant EXECUTE on new functions to anon and authenticated
-- directly (not only through PUBLIC), so revoking from PUBLIC alone leaves them callable.
-- The worker-only functions are revoked from every API role, then granted to service_role.
revoke all on function public.purge_property_photos(uuid), public.facts_confirmed(uuid), public.photo_property(uuid),
  public.geocode_gate(text), public.processing_consent(uuid)
  from public, anon;
revoke all on function public.queue_photo_deletion(), public.expire_photos(int, int), public.queue_orphan_photos(),
  public.claim_vision_job(), public.guard_findings(), public.consent_revoked(), public.geocode_store(text, jsonb),
  public.guard_photo_results()
  from public, anon, authenticated;

grant select, insert (property_id, requested_by) on public.vision_jobs to authenticated;
grant select on public.photo_results to authenticated;
grant select, update (condition, issue, suggested_fix, fix_item, quantity, severity, status, agent_note) on public.findings to authenticated;
grant execute on function public.purge_property_photos(uuid), public.facts_confirmed(uuid), public.photo_property(uuid),
  public.geocode_gate(text), public.processing_consent(uuid) to authenticated;

-- The worker and the geocode function (service role, server-side only).
grant all on public.storage_deletions, public.vision_jobs, public.photo_results, public.findings,
  public.geocode_cache, public.photos, public.properties, public.seller_consents, public.cost_book to service_role;
grant execute on function public.expire_photos(int, int), public.queue_orphan_photos(), public.claim_vision_job(),
  public.has_photo_consent(uuid), public.processing_consent(uuid), public.geocode_store(text, jsonb) to service_role;
