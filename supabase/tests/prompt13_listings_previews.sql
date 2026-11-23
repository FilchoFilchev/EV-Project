-- Prompt 13 only. Run AFTER reviewing/applying migration 20261123120000,
-- on an isolated LOCAL Supabase database with a trusted owner connection.
-- Metadata fixtures do not upload actual media. Browser tests verify WAV bytes.
-- New disposable identities and all changes are rolled back. No existing data
-- or previous Prompt 09/12 attack/cleanup scripts are read or modified.
begin;

do $trusted_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Prompt 13 fixtures require a trusted isolated local SQL role.';
  end if;
end;
$trusted_role$;

create temporary table prompt13_fixture (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid(),
  recording_id uuid not null default pg_catalog.gen_random_uuid(),
  version_id uuid not null default pg_catalog.gen_random_uuid(),
  source_name uuid not null default pg_catalog.gen_random_uuid(),
  preview_name uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
grant select on pg_temp.prompt13_fixture to authenticated;
insert into prompt13_fixture (principal) values ('seller'), ('other'), ('buyer'), ('renter'), ('expired_renter');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'prompt13-' || user_id::text || '@example.test',
  '{"display_name":"Prompt13 disposable SQL user"}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from prompt13_fixture;

insert into public.voice_recordings (id, owner_id, title, category, visibility)
select recording_id, user_id, 'Prompt13 disposable SQL recording', 'test', 'private'
from prompt13_fixture;

insert into storage.objects (bucket_id, name, metadata)
select 'voice-files', user_id::text || '/' || source_name::text || '.wav',
  '{"size":384044,"mimetype":"audio/wav"}'::jsonb from prompt13_fixture
where principal <> 'buyer'; -- Missing-source negative case; no real objects are uploaded.
insert into storage.objects (bucket_id, name, metadata)
select 'voice-previews', user_id::text || '/' || preview_name::text || '.wav',
  '{"size":192044,"mimetype":"audio/wav"}'::jsonb from prompt13_fixture;

insert into public.voice_versions (
  id, recording_id, effect_type, storage_path, duration_seconds, mime_type, file_size_bytes
)
select version_id, recording_id, 'original',
  user_id::text || '/' || source_name::text || '.wav', 12, 'audio/wav', 384044
from prompt13_fixture;

-- A legacy placeholder listing remains archivable without being rewritten.
insert into public.listings (version_id, status, sale_price_cents, preview_path)
select version_id, 'draft', 100, user_id::text || '/legacy-placeholder.wav'
from prompt13_fixture where principal = 'other';

set local role authenticated;
do $seller_checks$
declare
  f record;
  other_f record;
  v_path text;
  v_id uuid;
  v_count bigint;
begin
  select * into f from pg_temp.prompt13_fixture where principal = 'seller';
  select * into other_f from pg_temp.prompt13_fixture where principal = 'other';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
  v_path := f.user_id::text || '/' || f.preview_name::text || '.wav';

  if auth.uid() is distinct from f.user_id then raise exception 'FAIL: wrong seller JWT identity'; end if;
  if private.is_premium() then raise exception 'FAIL: seller should be Free'; end if;
  if pg_catalog.has_column_privilege('authenticated', 'public.listings', 'version_id', 'INSERT') then
    raise exception 'FAIL: direct listing INSERT privilege remains';
  end if;
  if pg_catalog.has_column_privilege('authenticated', 'public.listings', 'preview_path', 'UPDATE') then
    raise exception 'FAIL: direct preview reassignment privilege remains';
  end if;

  if not private.can_upload_voice_preview(v_path, '{"size":160044,"mimetype":"audio/wav"}')
    or not private.can_upload_voice_preview(v_path, '{"size":256044,"mimetype":"audio/wav"}')
    or private.can_upload_voice_preview(v_path, '{"size":256046,"mimetype":"audio/wav"}')
    or private.can_upload_voice_preview(v_path, '{"size":160042,"mimetype":"audio/wav"}')
    or private.can_upload_voice_preview(v_path, '{"size":192045,"mimetype":"audio/wav"}')
    or private.can_upload_voice_preview(v_path, '{"size":192044,"mimetype":"audio/mpeg"}')
    or private.can_upload_voice_preview(v_path, '{"size":"invalid","mimetype":"audio/wav"}')
    or private.can_upload_voice_preview(other_f.user_id::text || '/' || f.preview_name::text || '.wav',
      '{"size":192044,"mimetype":"audio/wav"}')
  then raise exception 'FAIL: preview upload path/MIME/size validation'; end if;

  begin
    perform public.publish_voice_listing(other_f.version_id, v_path, 6, 100, null, true, true);
    raise exception 'FAIL: published another owner version';
  exception when insufficient_privilege then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, null, null, true, true);
    raise exception 'FAIL: published without a price';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, -1, null, true, true);
    raise exception 'FAIL: published with a negative price';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, 100, 0, true, true);
    raise exception 'FAIL: published with zero rental price';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, 100, null, false, true);
    raise exception 'FAIL: published without public-source confirmation';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, 100, null, true, false);
    raise exception 'FAIL: published without voice-rights confirmation';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 4.99, 100, null, true, true);
    raise exception 'FAIL: published too-short preview';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 8.01, 100, null, true, true);
    raise exception 'FAIL: published too-long preview';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6.00001, 100, null, true, true);
    raise exception 'FAIL: accepted a fractional audio sample';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 5, 100, null, true, true);
    raise exception 'FAIL: accepted preview size/duration mismatch';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id,
      f.user_id::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav',
      6, 100, null, true, true);
    raise exception 'FAIL: accepted nonexistent preview object';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.publish_voice_listing(f.version_id,
      other_f.user_id::text || '/' || other_f.preview_name::text || '.wav',
      6, 100, null, true, true);
    raise exception 'FAIL: accepted another owner preview';
  exception when invalid_parameter_value then null; end;

  select count(*) into v_count from public.voice_recordings
  where id = f.recording_id and visibility = 'private';
  if v_count <> 1 then raise exception 'FAIL: failed publication changed source visibility'; end if;

  begin
    insert into public.listings (version_id, status, sale_price_cents, preview_path)
    values (f.version_id, 'published', 100, v_path);
    raise exception 'FAIL: direct INSERT bypassed publication checks';
  exception when insufficient_privilege then null; end;

  v_id := public.publish_voice_listing(f.version_id, v_path, 6, 1234, 250, true, true);
  perform pg_catalog.set_config('prompt13.listing_id', v_id::text, true);
  select count(*) into v_count from public.listings
  where id = v_id and status = 'published' and sale_price_cents = 1234
    and rental_price_cents = 250 and rental_days = 30 and currency = 'EUR'
    and preview_duration_seconds = 6;
  if v_count <> 1 then raise exception 'FAIL: published listing metadata'; end if;
  select count(*) into v_count from public.voice_recordings
  where id = f.recording_id and visibility = 'public';
  if v_count <> 1 then raise exception 'FAIL: source metadata was not made public'; end if;
  if private.can_delete_unreferenced_preview(v_path) then
    raise exception 'FAIL: referenced preview considered deletable';
  end if;
  begin
    perform public.publish_voice_listing(f.version_id, v_path, 6, 1234, 250, true, true);
    raise exception 'FAIL: duplicate listing permitted';
  exception when unique_violation then null; end;
  begin
    update public.listings set status = 'published' where id = v_id;
    raise exception 'FAIL: direct status UPDATE could publish';
  exception when insufficient_privilege then null; end;
end;
$seller_checks$;

do $unlicensed_buyer_checks$
declare
  f record;
  seller_f record;
  v_count bigint;
begin
  select * into f from pg_temp.prompt13_fixture where principal = 'buyer';
  select * into seller_f from pg_temp.prompt13_fixture where principal = 'seller';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
  begin
    perform public.publish_voice_listing(f.version_id,
      f.user_id::text || '/' || f.preview_name::text || '.wav', 6, 100, null, true, true);
    raise exception 'FAIL: published version without a real private source object';
  exception when invalid_parameter_value then null; end;
  select count(*) into v_count from public.marketplace_listing_summaries
  where listing_id = current_setting('prompt13.listing_id')::uuid;
  if v_count <> 1 then raise exception 'FAIL: public listing absent from safe metadata view'; end if;
  select count(*) into v_count from public.voice_versions where id = seller_f.version_id;
  if v_count <> 0 then raise exception 'FAIL: publication exposed private version metadata'; end if;
  select count(*) into v_count from storage.objects
  where bucket_id = 'voice-files'
    and name = seller_f.user_id::text || '/' || seller_f.source_name::text || '.wav';
  if v_count <> 0 then raise exception 'FAIL: publication exposed private source object'; end if;
  if private.can_access_audio_path(seller_f.user_id::text || '/' || seller_f.source_name::text || '.wav') then
    raise exception 'FAIL: unlicensed buyer received full-audio access';
  end if;
end;
$unlicensed_buyer_checks$;
reset role;

-- License setup is trusted fixture-only: no checkout implementation is added.
insert into public.licenses (listing_id, buyer_id, license_type, price_cents)
select current_setting('prompt13.listing_id')::uuid, user_id, 'buy', 1234
from prompt13_fixture where principal = 'buyer';
insert into public.licenses (listing_id, buyer_id, license_type, price_cents, expires_at)
select current_setting('prompt13.listing_id')::uuid, user_id, 'rent', 250,
  case principal when 'renter' then pg_catalog.now() + interval '30 days'
    else pg_catalog.now() - interval '1 second' end
from prompt13_fixture where principal in ('renter', 'expired_renter');

set local role authenticated;
do $archive_checks$
declare
  f record;
  v_rows bigint;
  v_count bigint;
begin
  select * into f from pg_temp.prompt13_fixture where principal = 'other';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
  update public.listings set status = 'archived' where id = current_setting('prompt13.listing_id')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: other user archived seller listing'; end if;
  update public.listings set status = 'archived' where version_id = f.version_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: legacy placeholder listing could not be archived'; end if;

  select * into f from pg_temp.prompt13_fixture where principal = 'seller';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
  update public.listings set status = 'archived' where id = current_setting('prompt13.listing_id')::uuid;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'FAIL: owner archive did not update one listing'; end if;
  select count(*) into v_count from storage.objects
  where bucket_id = 'voice-files' and name = f.user_id::text || '/' || f.source_name::text || '.wav';
  if v_count <> 1 then raise exception 'FAIL: archive removed private source'; end if;
  select count(*) into v_count from storage.objects
  where bucket_id = 'voice-previews' and name = f.user_id::text || '/' || f.preview_name::text || '.wav';
  if v_count <> 1 then raise exception 'FAIL: archive removed preview'; end if;
  if private.can_delete_unreferenced_preview(f.user_id::text || '/' || f.preview_name::text || '.wav') then
    raise exception 'FAIL: archived preview is deletable';
  end if;
end;
$archive_checks$;

do $licensed_buyer_checks$
declare
  f record;
  seller_f record;
  v_count bigint;
begin
  select * into f from pg_temp.prompt13_fixture where principal = 'buyer';
  select * into seller_f from pg_temp.prompt13_fixture where principal = 'seller';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
  if not private.has_valid_license_for_version(seller_f.version_id)
    or not private.can_access_audio_path(seller_f.user_id::text || '/' || seller_f.source_name::text || '.wav')
  then raise exception 'FAIL: archive revoked a permanent license'; end if;
  select count(*) into v_count from public.licenses where listing_id = current_setting('prompt13.listing_id')::uuid;
  if v_count <> 1 then raise exception 'FAIL: archive removed license history'; end if;
  select count(*) into v_count from public.listings where id = current_setting('prompt13.listing_id')::uuid;
  if v_count <> 1 then raise exception 'FAIL: licensed buyer lost archived listing history'; end if;
end;
$licensed_buyer_checks$;

do $rental_after_archive_checks$
declare
  f record;
  seller_f record;
  v_count bigint;
begin
  select * into seller_f from pg_temp.prompt13_fixture where principal = 'seller';
  for f in select * from pg_temp.prompt13_fixture where principal in ('renter', 'expired_renter') loop
    perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);
    if private.has_valid_license_for_version(seller_f.version_id) is distinct from (f.principal = 'renter')
      or private.can_access_audio_path(seller_f.user_id::text || '/' || seller_f.source_name::text || '.wav')
        is distinct from (f.principal = 'renter')
    then raise exception 'FAIL: wrong archived-listing rental access for %', f.principal; end if;
    select count(*) into v_count from public.voice_versions where id = seller_f.version_id;
    if v_count <> case when f.principal = 'renter' then 1 else 0 end then
      raise exception 'FAIL: wrong archived version visibility for %', f.principal;
    end if;
    select count(*) into v_count from public.licenses
    where listing_id = current_setting('prompt13.listing_id')::uuid;
    if v_count <> 1 then raise exception 'FAIL: archived rental history missing for %', f.principal; end if;
  end loop;
end;
$rental_after_archive_checks$;
reset role;

set local role anon;
do $anonymous_checks$
begin
  if pg_catalog.has_function_privilege('anon',
    'public.publish_voice_listing(uuid,text,numeric,integer,integer,boolean,boolean)', 'EXECUTE') then
    raise exception 'FAIL: anonymous publication EXECUTE privilege';
  end if;
end;
$anonymous_checks$;
reset role;
select 'Prompt 13 SQL assertions passed; all disposable fixtures will roll back.' as result;
rollback;
