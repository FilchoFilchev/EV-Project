-- DEVELOPMENT ONLY. Never run this script in production.
-- Confirm the Supabase Dashboard is set to echovault-dev before execution.
-- Replace both NULL UUID placeholders below: User B is the listing seller
-- and User A owns private recordings created by the API verification script.

do $rls_api_fixture_cleanup$
declare
  v_seller_id constant uuid := 'c0dceda7-3f18-4ba2-986c-df58f387f01c';
  v_user_a_id constant uuid := '207f9dbf-ae7e-42eb-9925-9fb371724e97';
  v_recording_ids constant uuid[] := array[
    'e703eea0-75c4-4c12-a100-000000000101'::uuid,
    'e703eea0-75c4-4c12-a100-000000000102'::uuid,
    'e703eea0-75c4-4c12-a100-000000000103'::uuid
  ];
  v_all_recording_ids uuid[];
begin
  if v_seller_id is null or v_user_a_id is null then
    raise exception 'Replace both UUID placeholders with the disposable User B and User A UUIDs.';
  end if;
  if v_seller_id = v_user_a_id then
    raise exception 'User A and User B must be different test accounts.';
  end if;
  if not exists (select 1 from public.profiles where id = v_seller_id)
     or not exists (select 1 from public.profiles where id = v_user_a_id)
  then
    raise exception 'Both supplied UUIDs must belong to existing RLS test profiles.';
  end if;

  if exists (
    select 1
    from public.voice_recordings as r
    where r.id = any(v_recording_ids)
      and (
        r.owner_id <> v_seller_id
        or r.title not in (
          'RLS API fixture DEV - published source',
          'RLS API fixture DEV - draft source',
          'RLS API fixture DEV - archived source'
        )
      )
  ) then
    raise exception 'A fixture recording ID does not match the expected owner and marker; cleanup stopped.';
  end if;

  if exists (
    select 1
    from public.voice_recordings as r
    where r.owner_id = v_user_a_id
      and r.title like 'RLS API verification %'
      and (
        r.description is distinct from 'Disposable private API RLS test fixture.'
        or r.visibility is distinct from 'private'
      )
  ) then
    raise exception 'An API-test title matched a non-fixture recording; cleanup stopped.';
  end if;

  select v_recording_ids || coalesce(pg_catalog.array_agg(r.id), array[]::uuid[])
    into v_all_recording_ids
  from public.voice_recordings as r
  where r.owner_id = v_user_a_id
    and r.title like 'RLS API verification %'
    and r.description = 'Disposable private API RLS test fixture.'
    and r.visibility = 'private';

  delete from public.reports as rep
  where rep.listing_id in (
    select l.id
    from public.listings as l
    join public.voice_versions as v on v.id = l.version_id
    where v.recording_id = any(v_all_recording_ids)
  );

  delete from public.licenses as lic
  where lic.listing_id in (
    select l.id
    from public.listings as l
    join public.voice_versions as v on v.id = l.version_id
    where v.recording_id = any(v_all_recording_ids)
  );

  delete from public.listings as l
  using public.voice_versions as v
  where l.version_id = v.id
    and v.recording_id = any(v_all_recording_ids);

  delete from public.voice_versions as v
  where v.recording_id = any(v_all_recording_ids);

  delete from public.voice_recordings as r
  where r.id = any(v_recording_ids)
    and r.owner_id = v_seller_id
    and r.title like 'RLS API fixture DEV - %';

  delete from public.voice_recordings as r
  where r.id = any(v_all_recording_ids)
    and r.owner_id = v_user_a_id
    and r.title like 'RLS API verification %'
    and r.description = 'Disposable private API RLS test fixture.'
    and r.visibility = 'private';

  raise notice 'Development RLS API fixtures and their dependent reports/licenses were removed.';
end;
$rls_api_fixture_cleanup$;
