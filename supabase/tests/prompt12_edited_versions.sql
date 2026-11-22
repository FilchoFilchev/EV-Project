-- Prompt 12 only. Run on an isolated local Supabase database after migrations.
-- Requires a trusted RLS-bypassing SQL role for temporary fixture setup.
-- Creates brand-new users/recordings/object metadata and rolls everything back.
-- No existing account, recording, Marketplace fixture, or Storage file changes.
-- These Storage rows model object metadata; browser tests cover real WAV bytes.
begin;

do $trusted_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Prompt 12 fixtures require a trusted local SQL role.';
  end if;
end;
$trusted_role$;

create temporary table prompt12_fixture (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid(),
  recording_id uuid not null default pg_catalog.gen_random_uuid(),
  original_name uuid not null default pg_catalog.gen_random_uuid(),
  edited_name uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
grant select on table prompt12_fixture to authenticated;

insert into prompt12_fixture (principal)
values ('free'), ('active'), ('expired'), ('null_expiry'), ('free_admin');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'prompt12-' || user_id::text || '@example.test',
  '{"display_name":"Prompt12 disposable SQL user"}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from prompt12_fixture;

update public.subscriptions as s
set plan = 'premium', expires_at = case f.principal
  when 'active' then pg_catalog.now() + interval '1 day'
  when 'expired' then pg_catalog.now() - interval '1 day'
  else null
end
from prompt12_fixture as f
where s.user_id = f.user_id and f.principal in ('active', 'expired', 'null_expiry');

update public.user_roles as r set role = 'admin'
from prompt12_fixture as f
where r.user_id = f.user_id and f.principal = 'free_admin';

insert into public.voice_recordings (id, owner_id, title, category, visibility)
select recording_id, user_id, 'Prompt12 disposable SQL recording', 'test', 'private'
from prompt12_fixture;

insert into storage.objects (bucket_id, name, metadata)
select 'voice-files', f.user_id::text || '/' || name::text || '.wav',
  '{"size":16044,"mimetype":"audio/wav"}'::jsonb
from prompt12_fixture as f
cross join lateral (values (f.original_name), (f.edited_name)) as names(name);

insert into public.voice_versions (
  recording_id, effect_type, effect_settings, storage_path,
  duration_seconds, mime_type, file_size_bytes
)
select recording_id, 'original', '{}'::jsonb,
  user_id::text || '/' || original_name::text || '.wav', 1, 'audio/wav', 16044
from prompt12_fixture;

set local role authenticated;

do $entitlements_and_insert$
declare
  f record;
  v_version_id uuid;
begin
  for f in select * from pg_temp.prompt12_fixture loop
    perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
    perform pg_catalog.set_config('request.jwt.claims',
      pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text,
      true);

    if public.has_active_premium() is distinct from (f.principal = 'active') then
      raise exception 'FAIL: wrong DB-time entitlement for %', f.principal;
    end if;

    if f.principal = 'active' then
      insert into public.voice_versions (
        recording_id, effect_type, effect_settings, storage_path,
        duration_seconds, mime_type, file_size_bytes
      ) values (
        f.recording_id, 'muffle', '{"intensity":50,"cutoffHz":2500}'::jsonb,
        f.user_id::text || '/' || f.edited_name::text || '.wav',
        1, 'audio/wav', 16044
      ) returning id into v_version_id;
      if v_version_id is null then raise exception 'FAIL: active Premium insert'; end if;
      raise notice 'PASS: active Premium saves a separate private WAV version';
    else
      begin
        insert into public.voice_versions (
          recording_id, effect_type, effect_settings, storage_path,
          duration_seconds, mime_type, file_size_bytes
        ) values (
          f.recording_id, 'muffle', '{"intensity":50}'::jsonb,
          f.user_id::text || '/' || f.edited_name::text || '.wav',
          1, 'audio/wav', 16044
        );
        raise exception 'FAIL: % inserted an edited version', f.principal;
      exception when insufficient_privilege then
        raise notice 'PASS: % edited insert denied by authorization', f.principal;
      end;
    end if;
  end loop;
end;
$entitlements_and_insert$;

-- Active Premium also cannot forge object metadata, edit an existing original,
-- create a version for another user, or reuse an already referenced object.
do $premium_negative_cases$
declare
  f record;
  v_other_recording_id uuid;
  v_case text;
  v_path text;
  v_recording_id uuid;
  v_settings jsonb;
  v_size bigint;
begin
  select * into f from pg_temp.prompt12_fixture where principal = 'active';
  select recording_id into v_other_recording_id
    from pg_temp.prompt12_fixture where principal = 'free';
  perform pg_catalog.set_config('request.jwt.claim.sub', f.user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', f.user_id, 'role', 'authenticated')::text,
    true);

  foreach v_case in array array['missing_object', 'wrong_size', 'invalid_settings', 'other_owner'] loop
    v_path := f.user_id::text || '/' || f.edited_name::text || '.wav';
    v_recording_id := f.recording_id;
    v_settings := '{"intensity":50}'::jsonb;
    v_size := 16044;
    if v_case = 'missing_object' then
      v_path := f.user_id::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav';
    elsif v_case = 'wrong_size' then v_size := 16045;
    elsif v_case = 'invalid_settings' then v_settings := '{"intensity":101}'::jsonb;
    elsif v_case = 'other_owner' then v_recording_id := v_other_recording_id;
    end if;
    begin
      insert into public.voice_versions (
        recording_id, effect_type, effect_settings, storage_path,
        duration_seconds, mime_type, file_size_bytes
      ) values (v_recording_id, 'echo', v_settings, v_path, 1, 'audio/wav', v_size);
      raise exception 'FAIL: Premium % was accepted', v_case;
    exception when insufficient_privilege then
      raise notice 'PASS: Premium % denied', v_case;
    end;
  end loop;

  begin
    insert into public.voice_versions (
      recording_id, effect_type, effect_settings, storage_path,
      duration_seconds, mime_type, file_size_bytes
    ) values (
      f.recording_id, 'echo', '{"intensity":50}'::jsonb,
      f.user_id::text || '/' || f.original_name::text || '.wav', 1, 'audio/wav', 16044
    );
    raise exception 'FAIL: an original object was reused';
  exception when unique_violation then
    raise notice 'PASS: a referenced original object cannot be reused';
  end;

  begin
    update public.voice_versions set effect_type = 'echo'
    where recording_id = f.recording_id and effect_type = 'original';
    raise exception 'FAIL: original version was mutable';
  exception when insufficient_privilege then
    raise notice 'PASS: original metadata is immutable';
  end;
end;
$premium_negative_cases$;

reset role;
rollback;
