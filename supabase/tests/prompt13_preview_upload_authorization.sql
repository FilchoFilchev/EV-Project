-- LOCAL ONLY, rollback-only. Run with stop-on-error against an isolated local
-- Supabase database after all eight migrations. Never run on the shared remote
-- project. These fixtures create no Storage file bytes and touch no existing
-- user data. No prior attack or cleanup script is needed.
begin;

do $trusted_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Preview upload fixtures require a trusted isolated local SQL role.';
  end if;
end;
$trusted_role$;

create temporary table preview_upload_fixture (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid(),
  object_name uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
grant select on pg_temp.preview_upload_fixture to authenticated, anon;
insert into preview_upload_fixture (principal) values ('owner'), ('other');

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'preview-upload-' || user_id::text || '@example.test',
  '{"display_name":"Preview upload disposable SQL user"}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from preview_upload_fixture;

insert into storage.objects (bucket_id, name, metadata)
select 'voice-previews', user_id::text || '/' || object_name::text || '.wav',
  '{"mimetype":"audio/wav","size":160044}'::jsonb
from preview_upload_fixture;

set local role authenticated;
do $authenticated_insert_checks$
declare
  v_owner uuid;
  v_other uuid;
  v_existing_path text;
  v_metadata jsonb;
  v_path text;
  v_id uuid;
  v_rows bigint;
begin
  select user_id, user_id::text || '/' || object_name::text || '.wav'
    into v_owner, v_existing_path
  from pg_temp.preview_upload_fixture where principal = 'owner';
  select user_id into v_other from pg_temp.preview_upload_fixture where principal = 'other';
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from v_owner then raise exception 'FAIL: wrong authenticated test identity'; end if;

  if not pg_catalog.has_function_privilege('authenticated',
    'private.can_upload_voice_preview(text,jsonb)', 'EXECUTE') then
    raise exception 'FAIL: upload policy helper EXECUTE grant was lost';
  end if;

  -- The first two cases reproduce the real pre-upload permission probe, which
  -- failed under the old helper because metadata.size was not yet available.
  -- Multipart request contentLength may exceed the exact file size or be odd.
  for v_metadata in select value from pg_catalog.jsonb_array_elements('[
    {"mimetype":"audio/wav"},
    {"mimetype":"audio/wav","contentLength":160044},
    {"mimetype":"audio/wav","contentLength":256411},
    {"mimetype":"audio/wav","size":160044},
    {"mimetype":"audio/wav","size":256044,"contentLength":256411}
  ]'::jsonb) loop
    v_path := v_owner::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav';
    begin
      insert into storage.objects (bucket_id, name, metadata)
      values ('voice-previews', v_path, v_metadata)
      returning id into v_id;
      if v_id is null then raise exception 'FAIL: allowed INSERT did not return an object'; end if;
      -- Match Storage's permission probe: roll back each successful INSERT.
      raise exception using errcode = 'P1301', message = 'Rollback successful upload authorization probe';
    exception when sqlstate 'P1301' then null;
    end;
    if exists (select 1 from storage.objects where bucket_id = 'voice-previews' and name = v_path) then
      raise exception 'FAIL: successful probe metadata was not rolled back';
    end if;
  end loop;

  for v_metadata in select value from pg_catalog.jsonb_array_elements('[
    {"mimetype":"audio/wav","size":null},
    {"mimetype":"audio/wav","size":"invalid"},
    {"mimetype":"audio/wav","size":160042},
    {"mimetype":"audio/wav","size":160045},
    {"mimetype":"audio/wav","size":256046},
    {"mimetype":"audio/mpeg"},
    {"mimetype":"audio/mpeg","size":160044},
    {"size":160044}
  ]'::jsonb) loop
    begin
      insert into storage.objects (bucket_id, name, metadata)
      values ('voice-previews', v_owner::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav', v_metadata);
      raise exception 'FAIL: invalid preview INSERT was accepted: %', v_metadata;
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('voice-previews', v_other::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav',
      '{"mimetype":"audio/wav"}'::jsonb);
    raise exception 'FAIL: another owner folder accepted a provisional upload';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('voice-previews', v_owner::text || '/unsafe-name.wav', '{"mimetype":"audio/wav"}'::jsonb);
    raise exception 'FAIL: a non-UUID filename was accepted';
  exception when insufficient_privilege then null;
  end;

  -- This correction must not enable overwriting an existing preview.
  update storage.objects set metadata = '{"mimetype":"audio/wav","size":256044}'::jsonb
  where bucket_id = 'voice-previews' and name = v_existing_path;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'FAIL: preview UPDATE became authorized'; end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'voice-previews'
      and name = v_existing_path and metadata ->> 'size' = '160044'
  ) then raise exception 'FAIL: existing preview metadata changed'; end if;
end;
$authenticated_insert_checks$;
reset role;

set local role anon;
do $anonymous_insert_check$
declare
  v_owner uuid;
begin
  select user_id into v_owner from pg_temp.preview_upload_fixture where principal = 'owner';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('voice-previews', v_owner::text || '/' || pg_catalog.gen_random_uuid()::text || '.wav',
      '{"mimetype":"audio/wav"}'::jsonb);
    raise exception 'FAIL: anonymous provisional upload accepted';
  exception when insufficient_privilege then null;
  end;
end;
$anonymous_insert_check$;
reset role;

select 'Preview upload SQL assertions passed; all fixtures will roll back.' as result;
rollback;
