-- Listing Prep Advisor P1 (intake): geocoded properties with agent-confirmed facts,
-- seller consent, room photos in private storage, the team's cost book, and quotes.
-- SPEC_LISTING_PREP.md §4 (flow), §8 (backend objects), §9 (P1).
--
-- Same security model as the core migration: row-level security everywhere, members of
-- a property's team work its rows, managers own the cost book, `anon` gets nothing, and
-- ownership/audit columns are not updatable. On top of that:
--   * Facts are validated in the database (known keys, types, ranges), and "confirmed"
--     is set only by confirm_facts(), which requires the core facts. Any later edit to
--     the facts clears the confirmation, so nothing downstream analyzes stale facts.
--   * Photos (rows and storage objects) require the seller's recorded, unrevoked consent
--     for that property, and live under <team>/<property>/ in a private bucket.
--   * Consents are an audit trail: no updates except revoking, no deletes.

-- ---------- properties: geocode + confirmed facts ----------

alter table public.properties
  add column matched_address text check (matched_address is null or char_length(matched_address) <= 300),
  add column tract text check (tract is null or tract ~ '^\d{11}$'),
  add column county_fips text check (county_fips is null or county_fips ~ '^\d{5}$'),
  add column place_id text check (place_id is null or place_id ~ '^\d{7}$'),
  add column facts_confirmed_at timestamptz,
  add column facts_confirmed_by uuid references auth.users (id) on delete set null;

-- The facts an agent confirms (SPEC_LISTING_PREP.md §4 step 2). Unknown keys, wrong types
-- and impossible values are rejected; every key is optional until confirm_facts().
create function public.valid_facts(f jsonb) returns boolean
language plpgsql immutable as $$
declare
  k text;
  num_keys constant text[] := array['beds', 'baths', 'sqft', 'lot_sqft', 'year_built', 'garage_spaces', 'stories', 'last_sale_price', 'hoa_monthly'];
  lo constant numeric[] := array[0, 0, 100, 0, 1800, 0, 1, 0, 0];
  hi constant numeric[] := array[30, 30, 50000, 50000000, 2100, 20, 6, 500000000, 50000];
  i int;
  v numeric;
begin
  if f is null or jsonb_typeof(f) <> 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(f) loop
    if k = any (num_keys) then
      if jsonb_typeof(f -> k) <> 'number' then return false; end if;
      i := array_position(num_keys, k);
      v := (f ->> k)::numeric;
      if v < lo[i] or v > hi[i] then return false; end if;
      if k in ('beds', 'sqft', 'lot_sqft', 'year_built', 'garage_spaces', 'stories') and v <> trunc(v) then return false; end if;
      if k = 'baths' and v * 4 <> trunc(v * 4) then return false; end if;
    elsif k = 'property_type' then
      if coalesce(f ->> k, '') not in ('single_family', 'condo', 'townhouse', 'multi_family', 'manufactured') then return false; end if;
    elsif k = 'pool' then
      if jsonb_typeof(f -> k) <> 'boolean' then return false; end if;
    elsif k = 'last_sale_date' then
      if jsonb_typeof(f -> k) <> 'string' or (f ->> k) !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.properties add constraint properties_facts_valid check (public.valid_facts(facts));

-- Editing the facts after confirmation un-confirms them.
create function public.facts_unconfirm() returns trigger
language plpgsql as $$
begin
  if new.facts is distinct from old.facts and new.facts_confirmed_at is not distinct from old.facts_confirmed_at then
    new.facts_confirmed_at := null;
    new.facts_confirmed_by := null;
  end if;
  return new;
end;
$$;
create trigger properties_facts_unconfirm before update on public.properties
  for each row execute function public.facts_unconfirm();

-- Confirm a property's facts (a member of its team; the core facts must be present).
create function public.confirm_facts(property uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  p public.properties;
  missing text[];
  at timestamptz := now();
begin
  select * into p from public.properties where id = property;
  if not found or not public.is_member(p.team_id) then
    raise exception 'no such property' using errcode = 'P0002';
  end if;
  select array_agg(k) into missing
    from unnest(array['beds', 'baths', 'sqft', 'year_built', 'property_type']) as k
    where not (p.facts ? k);
  if missing is not null then
    raise exception 'facts incomplete: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
  update public.properties set facts_confirmed_at = at, facts_confirmed_by = auth.uid() where id = property;
  return at;
end;
$$;

-- ---------- seller consent (photos go to the model only with it) ----------

create table public.seller_consents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  seller_name text not null check (char_length(btrim(seller_name)) between 1 and 200),
  method text not null check (method in ('signed_form', 'email', 'in_person')),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  given_on date not null default current_date,
  recorded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index seller_consents_property_idx on public.seller_consents (property_id);

create function public.has_photo_consent(property uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seller_consents where property_id = property and revoked_at is null)
$$;

-- Revoking is the only change; it can't be undone (record a new consent instead).
create function public.guard_consents() returns trigger
language plpgsql as $$
begin
  if old.revoked_at is not null or new.revoked_at is null then
    raise exception 'a consent can only be revoked, once' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger seller_consents_guard before update on public.seller_consents
  for each row execute function public.guard_consents();

-- ---------- photos (rows here; files in the private `property-photos` bucket) ----------

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  room text not null check (room in (
    'exterior_front', 'exterior_back', 'yard', 'entry', 'living', 'family', 'dining', 'kitchen',
    'primary_bedroom', 'bedroom', 'primary_bath', 'bath', 'half_bath', 'office', 'laundry',
    'garage', 'hallway', 'other')),
  label text check (label is null or char_length(label) <= 80),
  storage_path text not null unique,
  width int check (width between 1 and 10000),
  height int check (height between 1 and 10000),
  bytes int not null check (bytes between 1 and 10485760),
  mime text not null check (mime in ('image/jpeg', 'image/webp')),
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  -- <team>/<property>/<uuid>.<jpg|webp>, under this property's own folder
  check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'
         and split_part(storage_path, '/', 2) = property_id::text)
);
create index photos_property_idx on public.photos (property_id);

-- The storage folder of a photo path must be the property's team.
create function public.photo_path_ok(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    split_part(path, '/', 1) = (select team_id::text from public.properties where id::text = split_part(path, '/', 2)),
    false)
$$;

-- ---------- the team's cost book and per-property quotes ----------

create table public.cost_book (
  team_id uuid not null references public.teams (id) on delete cascade,
  item text not null check (item ~ '^[a-z0-9_]{2,60}$'),
  category text not null check (category ~ '^[a-z0-9_]{2,40}$'),
  unit text not null check (unit in ('each', 'piece', 'door', 'hour', 'month', 'sq_ft', 'sq_ft_floor_area', 'sq_ft_yard', 'linear_ft')),
  low_usd numeric(12, 2) check (low_usd is null or low_usd >= 0),
  high_usd numeric(12, 2) check (high_usd is null or high_usd >= 0),
  notes text check (notes is null or char_length(notes) <= 500),
  updated_by uuid not null default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (team_id, item),
  check ((low_usd is null) = (high_usd is null) and (low_usd is null or high_usd >= low_usd))
);
create trigger cost_book_touch before update on public.cost_book
  for each row execute function public.touch_updated_at();

-- Import or edit cost book rows by item. An upsert through PostgREST would SET every
-- column in the payload (team_id, item included), which the column grants forbid; this
-- updates only the price columns. SECURITY INVOKER: the policies above still decide.
create function public.save_cost_rows(team uuid, rows jsonb) returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;
  insert into public.cost_book (team_id, item, category, unit, low_usd, high_usd, notes, updated_by)
    select team, r.item, r.category, r.unit, r.low_usd, r.high_usd, r.notes, auth.uid()
    from jsonb_to_recordset(rows) as r(item text, category text, unit text, low_usd numeric, high_usd numeric, notes text)
  on conflict (team_id, item) do update
    set category = excluded.category, unit = excluded.unit, low_usd = excluded.low_usd,
        high_usd = excluded.high_usd, notes = excluded.notes, updated_by = excluded.updated_by;
  get diagnostics n = row_count;
  return n;
end;
$$;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  item text not null check (item ~ '^[a-z0-9_]{2,60}$'),
  low_usd numeric(12, 2) not null check (low_usd >= 0),
  high_usd numeric(12, 2) not null,
  vendor text check (vendor is null or char_length(vendor) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  quoted_on date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (high_usd >= low_usd)
);
create index quotes_property_idx on public.quotes (property_id);

-- ---------- row-level security ----------

alter table public.seller_consents enable row level security;
alter table public.photos enable row level security;
alter table public.cost_book enable row level security;
alter table public.quotes enable row level security;

create policy consents_read on public.seller_consents for select to authenticated
  using (public.is_member(public.property_team(property_id)));
create policy consents_record on public.seller_consents for insert to authenticated
  with check (public.is_member(public.property_team(property_id)) and recorded_by = auth.uid());
create policy consents_revoke on public.seller_consents for update to authenticated
  using (public.is_member(public.property_team(property_id)))
  with check (public.is_member(public.property_team(property_id)));

create policy photos_read on public.photos for select to authenticated
  using (public.is_member(public.property_team(property_id)));
create policy photos_add on public.photos for insert to authenticated
  with check (public.is_member(public.property_team(property_id)) and public.has_photo_consent(property_id)
              and public.photo_path_ok(storage_path) and uploaded_by = auth.uid());
create policy photos_relabel on public.photos for update to authenticated
  using (public.is_member(public.property_team(property_id)))
  with check (public.is_member(public.property_team(property_id)));
create policy photos_remove on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_manager(public.property_team(property_id)));

create policy cost_book_read on public.cost_book for select to authenticated using (public.is_member(team_id));
create policy cost_book_add on public.cost_book for insert to authenticated
  with check (public.is_manager(team_id) and updated_by = auth.uid());
create policy cost_book_edit on public.cost_book for update to authenticated
  using (public.is_manager(team_id)) with check (public.is_manager(team_id) and updated_by = auth.uid());
create policy cost_book_remove on public.cost_book for delete to authenticated using (public.is_manager(team_id));

create policy quotes_read on public.quotes for select to authenticated
  using (public.is_member(public.property_team(property_id)));
create policy quotes_add on public.quotes for insert to authenticated
  with check (public.is_member(public.property_team(property_id)) and created_by = auth.uid());
create policy quotes_edit on public.quotes for update to authenticated
  using (public.is_member(public.property_team(property_id)))
  with check (public.is_member(public.property_team(property_id)));
create policy quotes_remove on public.quotes for delete to authenticated
  using (created_by = auth.uid() or public.is_manager(public.property_team(property_id)));

-- ---------- storage: a private bucket, foldered by team and property ----------

insert into storage.buckets (id, name, public) values ('property-photos', 'property-photos', false)
  on conflict (id) do update set public = false;
-- Size and type limits where this Storage version has them (hosted projects do).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/webp'] where id = 'property-photos';
  end if;
end;
$$;

create policy property_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and public.photo_path_ok(name)
         and public.is_member(((storage.foldername(name))[1])::uuid));
create policy property_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos'
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'
              and public.photo_path_ok(name)
              and public.is_member(((storage.foldername(name))[1])::uuid)
              and public.has_photo_consent(((storage.foldername(name))[2])::uuid));
create policy property_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and public.photo_path_ok(name)
         and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------- privileges ----------

revoke all on public.seller_consents, public.photos, public.cost_book, public.quotes from anon, authenticated;
revoke all on function public.valid_facts(jsonb), public.facts_unconfirm(), public.confirm_facts(uuid), public.save_cost_rows(uuid, jsonb),
  public.has_photo_consent(uuid), public.guard_consents(), public.photo_path_ok(text) from public, anon;

grant insert (matched_address, tract, county_fips, place_id),
  update (matched_address, tract, county_fips, place_id)
  on public.properties to authenticated;
grant select, insert (property_id, seller_name, method, consent_version, given_on, recorded_by), update (revoked_at)
  on public.seller_consents to authenticated;
grant select, delete, insert (property_id, room, label, storage_path, width, height, bytes, mime, uploaded_by), update (room, label)
  on public.photos to authenticated;
grant select, delete, insert (team_id, item, category, unit, low_usd, high_usd, notes, updated_by),
  update (category, unit, low_usd, high_usd, notes, updated_by)
  on public.cost_book to authenticated;
grant select, delete, insert (property_id, item, low_usd, high_usd, vendor, notes, quoted_on, created_by),
  update (item, low_usd, high_usd, vendor, notes, quoted_on)
  on public.quotes to authenticated;
grant execute on function public.confirm_facts(uuid), public.save_cost_rows(uuid, jsonb), public.has_photo_consent(uuid), public.photo_path_ok(text),
  public.valid_facts(jsonb) to authenticated;
