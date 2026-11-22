-- READ ONLY. Select echovault-dev in the SQL Editor and verify its dashboard
-- project ref is zysyghbbbesatbehravb BEFORE running. The project_ref literal
-- below binds the confirmation to the intended project; it does not discover
-- which project the SQL Editor is connected to. Use its trusted postgres role.
-- Export/copy the single result as JSON only after verifying global_scope_verified
-- is true and attack_global_references is 0. Never delete Storage rows via SQL.
select
  'zysyghbbbesatbehravb'::text as project_ref,
  'voice-files'::text as bucket_id,
  '207f9dbf-ae7e-42eb-9925-9fb371724e97/4b33d735-ee6b-4acf-9b97-303920117a24.wav'::text as attack_path,
  pg_catalog.now() as checked_at,
  current_user as sql_role,
  exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) as global_scope_verified,
  (
    select pg_catalog.count(*) from public.voice_versions
    where storage_path = '207f9dbf-ae7e-42eb-9925-9fb371724e97/4b33d735-ee6b-4acf-9b97-303920117a24.wav'
  ) as attack_global_references;
