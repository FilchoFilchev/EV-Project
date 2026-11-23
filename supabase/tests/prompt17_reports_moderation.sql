-- Prompt 17 PostgreSQL/RLS assertions. ISOLATED LOCAL SUPABASE ONLY.
-- Use a trusted SQL role with ON_ERROR_STOP after every migration. Fixtures use
-- random disposable identities and metadata only; ALL changes are rolled back.
-- Do not run against echovault-dev, echovault, or any shared/remote database.
-- This tests PostgreSQL authorization, not HTTP audio delivery or browser UI.
begin;

do $trusted_role$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Prompt 17 requires an isolated local trusted SQL role.';
  end if;
end;
$trusted_role$;

create temporary table prompt17_users (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
insert into prompt17_users (principal)
values ('seller'), ('reporter'), ('unrelated'), ('buyer'), ('renter'), ('expired'), ('admin');
create temporary table prompt17_files (
  sample text primary key,
  recording_id uuid not null default pg_catalog.gen_random_uuid(),
  version_id uuid not null default pg_catalog.gen_random_uuid(),
  listing_id uuid not null default pg_catalog.gen_random_uuid(),
  storage_path text,
  preview_path text
) on commit drop;
insert into prompt17_files (sample) values ('published'), ('draft'), ('private');
update prompt17_files set storage_path = u.user_id::text || '/' || version_id::text || '.wav',
  preview_path = u.user_id::text || '/' || listing_id::text || '.wav'
from prompt17_users as u where u.principal = 'seller';
grant select on pg_temp.prompt17_users, pg_temp.prompt17_files to authenticated, anon;

-- Even forged signup metadata must bootstrap a free, ordinary user.
insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'prompt17-' || user_id::text || '@example.test',
  '{"display_name":"Prompt17 disposable user","role":"admin","plan":"premium"}'::jsonb,
  pg_catalog.now(), pg_catalog.now() from prompt17_users;
update public.user_roles set role = 'admin'
where user_id = (select user_id from prompt17_users where principal = 'admin');
insert into public.voice_recordings (id, owner_id, title, category, visibility)
select f.recording_id, u.user_id, 'Prompt17 disposable ' || f.sample, 'test',
  case when f.sample = 'private' then 'private' else 'public' end
from prompt17_files as f cross join prompt17_users as u where u.principal = 'seller';
insert into storage.objects (bucket_id, name, metadata)
select 'voice-files', storage_path, '{"size":384044,"mimetype":"audio/wav"}'::jsonb from prompt17_files
union all select 'voice-previews', preview_path, '{"size":192044,"mimetype":"audio/wav"}'::jsonb from prompt17_files;
insert into public.voice_versions (id, recording_id, effect_type, effect_settings,
  storage_path, duration_seconds, mime_type, file_size_bytes)
select version_id, recording_id, 'original', '{}'::jsonb, storage_path, 12, 'audio/wav', 384044
from prompt17_files;
insert into public.listings (id, version_id, status, sale_price_cents,
  rental_price_cents, preview_path, preview_duration_seconds)
select listing_id, version_id, case when sample = 'draft' then 'draft' else 'published' end,
  1200, 250, preview_path, 6 from prompt17_files;
insert into public.licenses (listing_id, buyer_id, license_type, price_cents, expires_at)
select f.listing_id, u.user_id, case when u.principal = 'buyer' then 'buy' else 'rent' end,
  250, case when u.principal = 'buyer' then null
    when u.principal = 'renter' then pg_catalog.now() + interval '1 day'
    else pg_catalog.now() - interval '1 second' end
from prompt17_files as f cross join prompt17_users as u
where f.sample = 'published' and u.principal in ('buyer', 'renter', 'expired');
create temporary table prompt17_license_snapshot on commit drop as
select lic.* from public.licenses as lic join prompt17_files as f on f.listing_id = lic.listing_id;
create temporary table prompt17_object_snapshot on commit drop as
select o.* from storage.objects as o join prompt17_files as f
on o.name in (f.storage_path, f.preview_path) and o.bucket_id in ('voice-files', 'voice-previews');

create function pg_temp.prompt17_assert(p_condition boolean, p_message text)
returns void language plpgsql as $function$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %', p_message; end if;
end;
$function$;
create function pg_temp.prompt17_identity(p_principal text)
returns void language plpgsql as $function$
declare v_id uuid;
begin
  select user_id into strict v_id from pg_temp.prompt17_users where principal = p_principal;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object(
    'sub', v_id, 'role', 'authenticated', 'user_metadata',
    pg_catalog.json_build_object('role', 'admin', 'plan', 'premium'))::text, true);
end;
$function$;
create function pg_temp.prompt17_expect_error(p_sql text, p_state text)
returns void language plpgsql as $function$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state = p_state then return; end if;
    raise exception 'FAIL: expected SQLSTATE %, received % for %', p_state, v_state, p_sql;
  end;
  raise exception 'FAIL: expected SQLSTATE %, statement succeeded: %', p_state, p_sql;
end;
$function$;

do $security_contract$
declare v_signature text; v_proc record;
begin
  foreach v_signature in array array[
    'public.create_listing_report(uuid,text)', 'public.admin_resolve_report(uuid)',
    'public.admin_moderate_listing(uuid,text)', 'public.admin_set_premium(uuid,text)',
    'public.admin_list_users(integer,integer)', 'public.admin_list_listings(integer,integer)',
    'public.admin_list_reports(integer,integer)'
  ] loop
    select p.prosecdef, p.proconfig into strict v_proc from pg_catalog.pg_proc as p
    where p.oid = v_signature::regprocedure;
    perform pg_temp.prompt17_assert(v_proc.prosecdef and v_proc.proconfig @> array['search_path=""'],
      'SECURITY DEFINER pins search_path: ' || v_signature);
    perform pg_temp.prompt17_assert(pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE'),
      'RPC grants are authenticated-only: ' || v_signature);
  end loop;
  perform pg_temp.prompt17_assert(not pg_catalog.has_any_column_privilege('authenticated',
    'public.reports', 'INSERT,UPDATE'), 'Direct report writes are revoked, including column ACLs');
  perform pg_temp.prompt17_assert(not pg_catalog.has_any_column_privilege('authenticated',
    'public.subscriptions', 'INSERT,UPDATE') and not pg_catalog.has_any_column_privilege('authenticated',
    'public.user_roles', 'INSERT,UPDATE'), 'Roles/plans cannot be edited directly');
  perform pg_temp.prompt17_assert((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.reports'::regclass), 'Reports keep RLS enabled');
  perform pg_temp.prompt17_assert(exists (select 1 from storage.buckets
    where id = 'voice-files' and public is false), 'Full audio remains private');
end;
$security_contract$;

set local role authenticated;
do $reporting$
declare v_listing uuid; v_report uuid; v_reason text;
begin
  select listing_id into v_listing from pg_temp.prompt17_files where sample = 'published';
  perform pg_temp.prompt17_identity('reporter');
  perform pg_temp.prompt17_assert(not private.is_admin() and not private.is_premium(),
    'Forged signup/JWT user metadata does not grant admin or Premium');
  v_reason := E' Rights concern\nPlease review.\tDetails ';
  v_report := public.create_listing_report(v_listing, v_reason);
  perform pg_catalog.set_config('prompt17.report_id', v_report::text, true);
  perform pg_temp.prompt17_assert(exists (select 1 from public.reports where id = v_report
    and reporter_id = auth.uid() and listing_id = v_listing and status = 'open'
    and resolved_at is null and created_at = pg_catalog.now()
    and reason = E'Rights concern\nPlease review.\tDetails'),
    'Authenticated report uses own identity, normalized text, open state and DB timestamp');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.create_listing_report(%L::uuid, %L)', v_listing, 'Duplicate'), '23505');
  perform pg_temp.prompt17_assert((select count(*) from public.reports
    where listing_id = v_listing and reporter_id = auth.uid()) = 1, 'Duplicate makes no second row');
  perform pg_temp.prompt17_identity('unrelated');
  perform pg_temp.prompt17_assert(not exists (select 1 from public.reports where id = v_report),
    'Unrelated user cannot read reporter identity or reason');
  perform pg_temp.prompt17_identity('seller');
  perform pg_temp.prompt17_assert(not exists (select 1 from public.reports where id = v_report),
    'Listing owner cannot read another user report');
  -- Documents do not forbid an owner reporting their own published listing.
  perform public.create_listing_report(v_listing, 'Owner rights concern');
end;
$reporting$;

do $invalid_reports$
declare v_listing uuid; v_sample text; v_reason text;
begin
  perform pg_temp.prompt17_identity('unrelated');
  select listing_id into v_listing from pg_temp.prompt17_files where sample = 'published';
  foreach v_reason in array array['', E' \t\n\r ', U&'\00A0\2000\FEFF',
    pg_catalog.repeat('a', 1001), 'bad' || pg_catalog.chr(1) || 'text',
    'bad' || pg_catalog.chr(127) || 'text', 'bad' || pg_catalog.chr(133) || 'text',
    'bad' || pg_catalog.chr(159) || 'text'] loop
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'select public.create_listing_report(%L::uuid, %L)', v_listing, v_reason), '22023');
  end loop;
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.create_listing_report(%L::uuid, null)', v_listing), '22023');
  perform pg_temp.prompt17_expect_error('select public.create_listing_report(null, ''reason'')', '22023');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.create_listing_report(%L::uuid, ''reason'')', pg_catalog.gen_random_uuid()), 'P0002');
  foreach v_sample in array array['draft', 'private'] loop
    select listing_id into v_listing from pg_temp.prompt17_files where sample = v_sample;
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'select public.create_listing_report(%L::uuid, ''reason'')', v_listing), 'P0002');
  end loop;
  select listing_id into v_listing from pg_temp.prompt17_files where sample = 'published';
  perform public.create_listing_report(v_listing, pg_catalog.repeat(U&'\+01F600', 1000));
  perform pg_temp.prompt17_assert(exists (select 1 from public.reports
    where reporter_id = auth.uid() and pg_catalog.char_length(reason) = 1000),
    'Unicode report length uses PostgreSQL characters rather than UTF-16 code units');
end;
$invalid_reports$;

do $non_admin_direct_abuse$
declare v_principal text; v_listing uuid; v_report uuid; v_user uuid;
begin
  select listing_id into v_listing from pg_temp.prompt17_files where sample = 'published';
  select user_id into v_user from pg_temp.prompt17_users where principal = 'reporter';
  v_report := pg_catalog.current_setting('prompt17.report_id')::uuid;
  foreach v_principal in array array['reporter', 'seller', 'unrelated'] loop
    perform pg_temp.prompt17_identity(v_principal);
    perform pg_temp.prompt17_expect_error('select * from public.admin_list_users()', '42501');
    perform pg_temp.prompt17_expect_error('select * from public.admin_list_listings()', '42501');
    perform pg_temp.prompt17_expect_error('select * from public.admin_list_reports()', '42501');
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'select public.admin_resolve_report(%L::uuid)', v_report), '42501');
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'select public.admin_moderate_listing(%L::uuid, ''archived'')', v_listing), '42501');
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'select public.admin_set_premium(%L::uuid, ''premium'')', v_user), '42501');
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'insert into public.reports(listing_id,reporter_id,reason) values (%L::uuid,%L::uuid,''forged'')',
      v_listing, v_user), '42501');
    perform pg_temp.prompt17_expect_error(pg_catalog.format(
      'update public.reports set status=''resolved'',resolved_at=now() where id=%L::uuid', v_report), '42501');
    perform pg_temp.prompt17_expect_error('update public.user_roles set role=''admin'' where user_id=auth.uid()', '42501');
    perform pg_temp.prompt17_expect_error('update public.subscriptions set plan=''premium'' where user_id=auth.uid()', '42501');
  end loop;
  perform pg_temp.prompt17_identity('unrelated');
  update public.listings set status = 'archived' where id = v_listing;
  perform pg_temp.prompt17_assert(exists (select 1 from public.listings where id = v_listing
    and status = 'published'), 'Normal unrelated direct listing update affects no row');
end;
$non_admin_direct_abuse$;

do $admin_actions$
declare v_listing uuid; v_report uuid; v_user uuid; v_draft uuid; v_private uuid;
begin
  perform pg_temp.prompt17_identity('admin');
  select listing_id into v_listing from pg_temp.prompt17_files where sample = 'published';
  select listing_id into v_draft from pg_temp.prompt17_files where sample = 'draft';
  select listing_id into v_private from pg_temp.prompt17_files where sample = 'private';
  select user_id into v_user from pg_temp.prompt17_users where principal = 'reporter';
  v_report := pg_catalog.current_setting('prompt17.report_id')::uuid;
  perform pg_temp.prompt17_assert(exists (select 1 from public.admin_list_users() where id = v_user)
    and (select count(*) from public.admin_list_listings() where id in
      (select listing_id from pg_temp.prompt17_files)) = 3
    and exists (select 1 from public.admin_list_reports() where id = v_report
      and listing_title = 'Prompt17 disposable published'), 'Admin can review users/listings/reports');
  perform pg_temp.prompt17_assert((select count(*) from public.admin_list_reports(0, 1)) = 1,
    'Read RPC respects pagination');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_users(-1, 100)', '22023');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_listings(0, 201)', '22023');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_reports(0, null)', '22023');
  perform public.admin_resolve_report(v_report);
  perform pg_temp.prompt17_assert(exists (select 1 from public.reports where id = v_report
    and status = 'resolved' and resolved_at = pg_catalog.now()
    and created_at = pg_catalog.now() and reporter_id = v_user
    and reason = E'Rights concern\nPlease review.\tDetails'),
    'Resolve records DB timestamp and preserves report evidence');
  perform public.admin_moderate_listing(v_listing, 'archived');
  perform public.admin_moderate_listing(v_listing, 'archived');
  perform pg_temp.prompt17_assert(exists (select 1 from public.listings
    where id = v_listing and status = 'archived') and not exists
    (select 1 from public.marketplace_listing_summaries where listing_id = v_listing),
    'Archive is retry-safe and removes listing from Marketplace projection');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_moderate_listing(%L::uuid, ''draft'')', v_listing), '22023');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_moderate_listing(%L::uuid, ''published'')', v_draft), '22023');
  perform public.admin_moderate_listing(v_private, 'archived');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_moderate_listing(%L::uuid, ''published'')', v_private), '22023');
  perform pg_temp.prompt17_expect_error('select public.admin_resolve_report(null)', '22023');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_resolve_report(%L::uuid)', pg_catalog.gen_random_uuid()), 'P0002');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_moderate_listing(%L::uuid, ''archived'')', pg_catalog.gen_random_uuid()), 'P0002');
  perform public.admin_set_premium(v_user, 'premium');
  perform pg_temp.prompt17_assert(exists (select 1 from public.subscriptions where user_id = v_user
    and plan = 'premium' and expires_at = pg_catalog.now() + interval '30 days'
    and updated_at = pg_catalog.now()), 'Admin grants exactly 30 days of DB-time demo Premium');
  perform pg_temp.prompt17_assert(not private.is_premium(), 'Admin role alone does not grant Premium');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_set_premium(%L::uuid, ''admin'')', v_user), '22023');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.admin_set_premium(%L::uuid, ''premium'')', pg_catalog.gen_random_uuid()), 'P0002');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'update public.reports set resolved_at=now() where id=%L::uuid', v_report), '42501');
end;
$admin_actions$;

do $archived_entitlements_and_privacy$
declare v_principal text; v_version uuid; v_path text; v_listing uuid;
begin
  select version_id, storage_path, listing_id into v_version, v_path, v_listing
  from pg_temp.prompt17_files where sample = 'published';
  foreach v_principal in array array['buyer', 'renter'] loop
    perform pg_temp.prompt17_identity(v_principal);
    perform pg_temp.prompt17_assert(private.has_valid_license_for_version(v_version)
      and private.can_access_audio_path(v_path) and exists (select 1 from storage.objects
        where bucket_id = 'voice-files' and name = v_path),
      'Admin archive preserves private full-audio entitlement for ' || v_principal);
  end loop;
  foreach v_principal in array array['expired', 'unrelated', 'reporter', 'admin'] loop
    perform pg_temp.prompt17_identity(v_principal);
    perform pg_temp.prompt17_assert(not private.can_access_audio_path(v_path)
      and not exists (select 1 from storage.objects where bucket_id = 'voice-files' and name = v_path),
      'Admin archive grants no new private audio access to ' || v_principal);
  end loop;
  perform pg_temp.prompt17_identity('unrelated');
  perform pg_temp.prompt17_assert(not exists (select 1 from public.listings where id = v_listing),
    'Unlicensed unrelated user cannot read archived listing');
  perform pg_temp.prompt17_identity('renter');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.create_listing_report(%L::uuid, ''archived report'')', v_listing), 'P0002');
  perform pg_temp.prompt17_identity('seller');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'update public.listings set status=''published'' where id=%L::uuid', v_listing), '42501');
  perform pg_temp.prompt17_assert(exists (select 1 from storage.objects
    where bucket_id = 'voice-files' and name = v_path), 'Owner keeps original private audio');
  perform pg_temp.prompt17_identity('reporter');
  perform pg_temp.prompt17_assert(private.is_premium() and not private.is_admin(),
    'Demo Premium changes plan independently from user role');
  perform pg_temp.prompt17_expect_error(pg_catalog.format(
    'select public.create_listing_report(%L::uuid, ''resolved duplicate'')', v_listing), '23505');
  perform pg_temp.prompt17_assert(exists (select 1 from public.reports
    where id = pg_catalog.current_setting('prompt17.report_id')::uuid and status = 'resolved'),
    'Reporter can read own resolved report');
  perform pg_temp.prompt17_identity('admin');
  perform public.admin_moderate_listing(v_listing, 'published');
  perform pg_temp.prompt17_assert(exists (select 1 from public.marketplace_listing_summaries
    where listing_id = v_listing), 'Admin restores archived listing to Marketplace');
  perform public.admin_set_premium((select user_id from pg_temp.prompt17_users
    where principal = 'reporter'), 'free');
  perform pg_temp.prompt17_identity('reporter');
  perform pg_temp.prompt17_assert(not private.is_premium() and exists
    (select 1 from public.subscriptions where user_id = auth.uid() and plan = 'free' and expires_at is null),
    'Admin can turn off demo Premium without changing user role');
end;
$archived_entitlements_and_privacy$;
reset role;

-- Distinct historical timestamp makes retry preservation observable even though
-- now() remains fixed during this transaction. Trusted disposable fixture only.
update public.reports set resolved_at = pg_catalog.now() - interval '1 day'
where id = pg_catalog.current_setting('prompt17.report_id')::uuid;
set local role authenticated;
do $retry_preserves_audit$
begin
  perform pg_temp.prompt17_identity('admin');
  perform public.admin_resolve_report(pg_catalog.current_setting('prompt17.report_id')::uuid);
  perform pg_temp.prompt17_assert(exists (select 1 from public.reports
    where id = pg_catalog.current_setting('prompt17.report_id')::uuid
    and resolved_at = pg_catalog.now() - interval '1 day'), 'Resolve retry preserves first resolution timestamp');
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_users()', '42501');
  perform pg_temp.prompt17_expect_error('select public.create_listing_report(null,''reason'')', '42501');
end;
$retry_preserves_audit$;
reset role;

set local role anon;
do $anonymous_denial$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  perform pg_temp.prompt17_expect_error('select public.create_listing_report(null,''reason'')', '42501');
  perform pg_temp.prompt17_expect_error('select public.admin_resolve_report(null)', '42501');
  perform pg_temp.prompt17_expect_error('select public.admin_moderate_listing(null,''archived'')', '42501');
  perform pg_temp.prompt17_expect_error('select public.admin_set_premium(null,''premium'')', '42501');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_users()', '42501');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_listings()', '42501');
  perform pg_temp.prompt17_expect_error('select * from public.admin_list_reports()', '42501');
  perform pg_temp.prompt17_expect_error('select id from public.reports', '42501');
end;
$anonymous_denial$;
reset role;

do $preservation$
begin
  perform pg_temp.prompt17_assert(not exists (
    (select * from pg_temp.prompt17_license_snapshot except
      select lic.* from public.licenses as lic join pg_temp.prompt17_files as f on f.listing_id = lic.listing_id)
    union all
    (select lic.* from public.licenses as lic join pg_temp.prompt17_files as f on f.listing_id = lic.listing_id
      except select * from pg_temp.prompt17_license_snapshot)), 'All license rows remain byte-for-byte unchanged');
  perform pg_temp.prompt17_assert(not exists (
    (select * from pg_temp.prompt17_object_snapshot except
      select o.* from storage.objects as o join pg_temp.prompt17_files as f
      on o.name in (f.storage_path, f.preview_path) and o.bucket_id in ('voice-files','voice-previews'))
    union all
    (select o.* from storage.objects as o join pg_temp.prompt17_files as f
      on o.name in (f.storage_path, f.preview_path) and o.bucket_id in ('voice-files','voice-previews')
      except select * from pg_temp.prompt17_object_snapshot)), 'Original and preview object metadata remains unchanged');
  perform pg_temp.prompt17_assert((select count(*) from public.voice_versions where id in
    (select version_id from pg_temp.prompt17_files)) = 3 and
    (select count(*) from public.voice_recordings where id in
    (select recording_id from pg_temp.prompt17_files)) = 3, 'Source rows are never deleted');
end;
$preservation$;

select 'PASS: Prompt 17 local SQL assertions. Every disposable fixture and moderation change rolls back.' as result;
rollback;

begin isolation level repeatable read;
set local role authenticated;
do $unsupported_snapshot$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  begin
    perform public.create_listing_report(pg_catalog.gen_random_uuid(), 'reason');
    raise exception 'FAIL: reporting accepted an unsupported older transaction snapshot';
  exception when sqlstate '25000' then null; end;
end;
$unsupported_snapshot$;
reset role;
rollback;
