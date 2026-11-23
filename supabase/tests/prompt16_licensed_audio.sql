-- Prompt 16 focused PostgreSQL/RLS tests. LOCAL ISOLATED SUPABASE ONLY.
-- Run with a trusted SQL role and ON_ERROR_STOP after all existing migrations.
-- These are random disposable metadata fixtures, not actual audio uploads.
-- Every fixture and seller archive operation is rolled back. Never run against
-- echovault-dev or other shared/remote data. Storage HTTP byte delivery is a
-- separate browser/API check; SELECT below exercises its database authorization.
begin;

do $trusted_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Prompt 16 fixtures require a trusted isolated local SQL role.';
  end if;
end;
$trusted_role$;

create temporary table prompt16_users (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
insert into prompt16_users (principal)
values ('seller'), ('buyer'), ('renter'), ('expired'), ('boundary'), ('outsider'), ('admin');

create temporary table prompt16_files (
  sample text primary key,
  recording_id uuid not null,
  version_id uuid not null default pg_catalog.gen_random_uuid(),
  listing_id uuid not null default pg_catalog.gen_random_uuid(),
  storage_path text,
  mime_type text not null
) on commit drop;
insert into prompt16_files (sample, recording_id, mime_type)
values ('licensed', pg_catalog.gen_random_uuid(), 'audio/webm'),
  ('unrelated', pg_catalog.gen_random_uuid(), 'audio/wav');
insert into prompt16_files (sample, recording_id, mime_type)
select 'sibling', recording_id, 'audio/wav' from prompt16_files where sample = 'licensed';
update prompt16_files set storage_path =
  (select user_id::text from prompt16_users where principal = 'seller') || '/' ||
  version_id::text || case when mime_type = 'audio/webm' then '.webm' else '.wav' end;
grant select on pg_temp.prompt16_users, pg_temp.prompt16_files to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'prompt16-' || user_id::text || '@example.test',
  '{"display_name":"Prompt16 disposable SQL user"}'::jsonb,
  pg_catalog.now(), pg_catalog.now() from prompt16_users;
update public.user_roles set role = 'admin'
where user_id = (select user_id from prompt16_users where principal = 'admin');
insert into public.voice_recordings (id, owner_id, title, category, visibility)
select recording_id, u.user_id, 'Prompt16 disposable ' || sample, 'test', 'public'
from prompt16_files cross join prompt16_users as u
where sample <> 'sibling' and u.principal = 'seller';
insert into storage.objects (bucket_id, name, metadata)
select 'voice-files', storage_path,
  pg_catalog.jsonb_build_object('size', 384044, 'mimetype', mime_type) from prompt16_files;
insert into public.voice_versions (
  id, recording_id, effect_type, effect_settings, storage_path,
  duration_seconds, mime_type, file_size_bytes
)
select version_id, recording_id,
  case when sample = 'sibling' then 'echo' else 'original' end,
  case when sample = 'sibling' then '{"intensity":50}'::jsonb else '{}'::jsonb end,
  storage_path, 12, mime_type, 384044 from prompt16_files;
insert into public.listings (
  id, version_id, status, sale_price_cents, rental_price_cents,
  rental_days, currency, preview_path, preview_duration_seconds
)
select listing_id, version_id, 'published', 1234, 250, 30, 'EUR',
  u.user_id::text || '/' || listing_id::text || '.wav', 6
from prompt16_files cross join prompt16_users as u where u.principal = 'seller';
insert into public.licenses (
  listing_id, buyer_id, license_type, price_cents, created_at, expires_at
)
select f.listing_id, u.user_id,
  case when u.principal = 'buyer' then 'buy' else 'rent' end, 250,
  pg_catalog.now() - interval '30 days',
  case u.principal when 'buyer' then null
    when 'renter' then pg_catalog.now() + interval '1 day'
    when 'boundary' then pg_catalog.now()
    else pg_catalog.now() - interval '1 second' end
from prompt16_files as f cross join prompt16_users as u
where f.sample = 'licensed' and u.principal in ('buyer', 'renter', 'expired', 'boundary');

create function pg_temp.prompt16_assert(p_condition boolean, p_message text)
returns void language plpgsql as $function$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %', p_message; end if;
end;
$function$;
create function pg_temp.prompt16_identity(p_principal text)
returns void language plpgsql as $function$
declare v_id uuid;
begin
  select user_id into strict v_id from pg_temp.prompt16_users where principal = p_principal;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end;
$function$;

do $security_contract$
declare v_signature text; v_proc record;
begin
  perform pg_temp.prompt16_assert(exists (select 1 from storage.buckets
    where id = 'voice-files' and public is false), 'Full audio bucket remains private');
  perform pg_temp.prompt16_assert(exists (select 1 from storage.buckets
    where id = 'voice-previews' and public is true), 'Separate preview bucket remains public');
  perform pg_temp.prompt16_assert((select relrowsecurity from pg_catalog.pg_class
    where oid = 'storage.objects'::regclass), 'Storage RLS remains enabled');
  foreach v_signature in array array[
    'private.has_valid_license_for_version(uuid)',
    'private.can_access_audio_path(text)', 'private.can_read_version(uuid)'
  ] loop
    select p.prosecdef, p.proconfig into strict v_proc from pg_catalog.pg_proc as p
    where p.oid = v_signature::regprocedure;
    perform pg_temp.prompt16_assert(v_proc.prosecdef
      and v_proc.proconfig @> array['search_path=""'], 'Trusted helper pins search_path: ' || v_signature);
    perform pg_temp.prompt16_assert(pg_catalog.has_function_privilege('authenticated',
      v_signature, 'EXECUTE') and not pg_catalog.has_function_privilege('anon',
      v_signature, 'EXECUTE'), 'Only authenticated can invoke helper: ' || v_signature);
  end loop;
  perform pg_temp.prompt16_assert(not pg_catalog.has_column_privilege('authenticated',
    'public.listings', 'version_id', 'UPDATE'), 'Listing cannot be redirected to another version');
  perform pg_temp.prompt16_assert(not pg_catalog.has_column_privilege('authenticated',
    'public.voice_versions', 'storage_path', 'UPDATE'), 'Version path cannot be redirected');
  perform pg_temp.prompt16_assert(not pg_catalog.has_any_column_privilege('authenticated',
    'public.licenses', 'INSERT,UPDATE'), 'Clients cannot forge or extend licenses');
end;
$security_contract$;

set local role authenticated;
do $owner_access$
begin
  perform pg_temp.prompt16_identity('seller');
  perform pg_temp.prompt16_assert((select count(*) from storage.objects
    where bucket_id = 'voice-files' and name in (select storage_path from pg_temp.prompt16_files)) = 3,
    'Owner can access all of their fixture audio');
end;
$owner_access$;

do $valid_purchase_and_rental$
declare v_principal text; v_version uuid; v_path text;
begin
  select version_id, storage_path into v_version, v_path from pg_temp.prompt16_files where sample = 'licensed';
  foreach v_principal in array array['buyer', 'renter'] loop
    perform pg_temp.prompt16_identity(v_principal);
    perform pg_temp.prompt16_assert(private.has_valid_license_for_version(v_version)
      and private.can_access_audio_path(v_path), 'Valid ' || v_principal || ' entitlement');
    perform pg_temp.prompt16_assert(exists (select 1 from public.voice_versions
      where id = v_version and storage_path = v_path and mime_type = 'audio/webm'),
      'Exact licensed version metadata is readable with original WebM MIME');
    perform pg_temp.prompt16_assert(exists (select 1 from storage.objects
      where bucket_id = 'voice-files' and name = v_path), 'Private Storage read allowed for ' || v_principal);
    perform pg_temp.prompt16_assert(not exists (select 1 from storage.objects
      where bucket_id = 'voice-files' and name in (select storage_path from pg_temp.prompt16_files
        where sample in ('sibling', 'unrelated'))), 'Same-recording sibling and unrelated version denied for ' || v_principal);
    perform pg_temp.prompt16_assert(not exists (select 1 from public.voice_versions
      where id in (select version_id from pg_temp.prompt16_files where sample <> 'licensed')),
      'Public source visibility does not grant full version metadata');
    perform pg_temp.prompt16_assert(not private.can_access_audio_path(v_path || '.wav')
      and not private.can_access_audio_path('../' || v_path), 'Guessed alternative paths denied');
    perform pg_temp.prompt16_assert(not exists (select 1 from public.licenses
      where buyer_id <> auth.uid()), 'Cross-user license rows denied');
  end loop;
end;
$valid_purchase_and_rental$;

do $expired_and_unlicensed_denial$
declare v_principal text; v_version uuid; v_path text;
begin
  select version_id, storage_path into v_version, v_path from pg_temp.prompt16_files where sample = 'licensed';
  foreach v_principal in array array['expired', 'boundary', 'outsider', 'admin'] loop
    perform pg_temp.prompt16_identity(v_principal);
    perform pg_temp.prompt16_assert(not private.has_valid_license_for_version(v_version)
      and not private.can_access_audio_path(v_path), 'DB-time entitlement denied for ' || v_principal);
    perform pg_temp.prompt16_assert(not exists (select 1 from storage.objects
      where bucket_id = 'voice-files' and name = v_path), 'Private Storage read denied for ' || v_principal);
    perform pg_temp.prompt16_assert(not exists (select 1 from public.voice_versions where id = v_version),
      'Private full-version metadata denied for ' || v_principal);
  end loop;
  perform pg_temp.prompt16_identity('expired');
  begin
    update public.licenses set expires_at = pg_catalog.now() + interval '1 year' where buyer_id = auth.uid();
    raise exception 'FAIL: client extended expired rental';
  exception when insufficient_privilege then null; end;
  perform pg_temp.prompt16_assert(not private.has_valid_license_for_version(v_version),
    'Expiry remains enforced after rejected extension');
end;
$expired_and_unlicensed_denial$;

do $seller_archive_preserves_rights$
declare v_version uuid; v_listing uuid; v_path text; v_principal text;
begin
  select version_id, listing_id, storage_path into v_version, v_listing, v_path
  from pg_temp.prompt16_files where sample = 'licensed';
  perform pg_temp.prompt16_identity('seller');
  update public.listings set status = 'archived' where id = v_listing;
  perform pg_temp.prompt16_assert(exists (select 1 from public.listings
    where id = v_listing and status = 'archived'), 'Seller archive succeeds without deletion');
  foreach v_principal in array array['buyer', 'renter'] loop
    perform pg_temp.prompt16_identity(v_principal);
    perform pg_temp.prompt16_assert(private.has_valid_license_for_version(v_version)
      and exists (select 1 from storage.objects where bucket_id = 'voice-files' and name = v_path)
      and exists (select 1 from public.voice_versions where id = v_version)
      and exists (select 1 from public.listings where id = v_listing and status = 'archived'),
      'Archive preserves exact licensed audio and metadata for ' || v_principal);
  end loop;
  perform pg_temp.prompt16_identity('expired');
  perform pg_temp.prompt16_assert(not private.has_valid_license_for_version(v_version)
    and not exists (select 1 from storage.objects where bucket_id = 'voice-files' and name = v_path),
    'Archival does not revive expired rental');
  perform pg_temp.prompt16_assert(exists (select 1 from public.licenses
    where listing_id = v_listing and buyer_id = auth.uid() and expires_at < pg_catalog.now()),
    'Expired buyer can still read their own license receipt');
  perform pg_temp.prompt16_assert(not exists (select 1 from public.listings where id = v_listing)
    and not exists (select 1 from public.voice_versions where id = v_version),
    'Archived expired listing and private version remain hidden');
  perform pg_temp.prompt16_identity('outsider');
  perform pg_temp.prompt16_assert(not exists (select 1 from storage.objects
    where bucket_id = 'voice-files' and name = v_path), 'Archival does not grant outsider access');
end;
$seller_archive_preserves_rights$;

do $missing_identity_denial$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  perform pg_temp.prompt16_assert(not exists (select 1 from storage.objects
    where bucket_id = 'voice-files' and name in (select storage_path from pg_temp.prompt16_files)),
    'Missing authenticated identity cannot read private files');
end;
$missing_identity_denial$;
reset role;

set local role anon;
do $anonymous_denial$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  -- Either table privilege denial or an empty RLS result denies Storage access.
  begin
    perform pg_temp.prompt16_assert(not exists (select 1 from storage.objects
      where bucket_id = 'voice-files' and name in (select storage_path from pg_temp.prompt16_files)),
      'Anonymous private Storage read denied');
  exception when insufficient_privilege then null; end;
  begin
    perform private.can_access_audio_path((select storage_path from pg_temp.prompt16_files where sample = 'licensed'));
    raise exception 'FAIL: anonymous private helper invocation permitted';
  exception when insufficient_privilege then null; end;
end;
$anonymous_denial$;
reset role;

select 'PASS: Prompt 16 local SQL authorization assertions; all fixtures roll back.' as result;
rollback;
