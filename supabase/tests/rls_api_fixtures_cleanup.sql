-- DEVELOPMENT ONLY. Never run this script in production.
-- Confirm the Supabase Dashboard is set to echovault-dev before execution.
-- Verify the UUIDs below: User B is the listing seller and User A owns
-- private recordings created by the API verification script.
-- This removes marked database fixtures only, never Storage objects.

do $rls_api_fixture_cleanup$
declare
  v_seller_id constant uuid := 'c0dceda7-3f18-4ba2-986c-df58f387f01c';
  v_user_a_id constant uuid := '207f9dbf-ae7e-42eb-9925-9fb371724e97';
  v_recording_ids constant uuid[] := array[
    'e703eea0-75c4-4c12-a100-000000000101'::uuid,
    'e703eea0-75c4-4c12-a100-000000000102'::uuid,
    'e703eea0-75c4-4c12-a100-000000000103'::uuid
  ];
  v_version_ids constant uuid[] := array[
    'e703eea0-75c4-4c12-a100-000000000201'::uuid,
    'e703eea0-75c4-4c12-a100-000000000202'::uuid,
    'e703eea0-75c4-4c12-a100-000000000203'::uuid
  ];
  v_listing_ids constant uuid[] := array[
    'e703eea0-75c4-4c12-a100-000000000301'::uuid,
    'e703eea0-75c4-4c12-a100-000000000302'::uuid,
    'e703eea0-75c4-4c12-a100-000000000303'::uuid
  ];
  v_all_recording_ids uuid[];
  v_storage_paths text[];
begin
  if v_seller_id is null or v_user_a_id is null then
    raise exception 'Set the fixture IDs to the disposable User B and User A UUIDs.';
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

  if exists (
    select 1
    from public.voice_recordings as r
    where r.owner_id = v_user_a_id
      and r.title like 'RLS Storage API verification %'
      and (
        r.description is distinct from 'Disposable private original Storage API fixture.'
        or r.visibility is distinct from 'private'
      )
  ) then
    raise exception 'A Storage API test title matched a non-fixture recording; cleanup stopped.';
  end if;

  select v_recording_ids || coalesce(pg_catalog.array_agg(r.id), array[]::uuid[])
    into v_all_recording_ids
  from public.voice_recordings as r
  where r.owner_id = v_user_a_id
    and (
      (
        r.title like 'RLS API verification %'
        and r.description = 'Disposable private API RLS test fixture.'
        and r.visibility = 'private'
      )
      or (
        r.title like 'RLS Storage API verification %'
        and r.description = 'Disposable private original Storage API fixture.'
        and r.visibility = 'private'
      )
    );

  if exists (
    select 1
    from public.voice_versions as v
    where v.recording_id = any(v_recording_ids)
      and not (
        (v.id = 'e703eea0-75c4-4c12-a100-000000000201'::uuid
          and v.recording_id = 'e703eea0-75c4-4c12-a100-000000000101'::uuid
          and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-published.placeholder')
        or (v.id = 'e703eea0-75c4-4c12-a100-000000000202'::uuid
          and v.recording_id = 'e703eea0-75c4-4c12-a100-000000000102'::uuid
          and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-draft.placeholder')
        or (v.id = 'e703eea0-75c4-4c12-a100-000000000203'::uuid
          and v.recording_id = 'e703eea0-75c4-4c12-a100-000000000103'::uuid
          and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-archived.placeholder')
      )
  ) or exists (
    select 1
    from public.voice_versions as v
    where v.id = any(v_version_ids)
      and v.recording_id <> all(v_recording_ids)
  ) then
    raise exception 'Marketplace fixture versions do not match their fixed disposable IDs and paths; cleanup stopped.';
  end if;

  if exists (
    select 1
    from public.listings as l
    join public.voice_versions as v on v.id = l.version_id
    where v.recording_id = any(v_all_recording_ids)
      and l.id <> all(v_listing_ids)
  ) or exists (
    select 1
    from public.listings as l
    where l.id = any(v_listing_ids)
      and not (
        (l.id = 'e703eea0-75c4-4c12-a100-000000000301'::uuid
          and l.version_id = 'e703eea0-75c4-4c12-a100-000000000201'::uuid
          and l.status = 'published')
        or (l.id = 'e703eea0-75c4-4c12-a100-000000000302'::uuid
          and l.version_id = 'e703eea0-75c4-4c12-a100-000000000202'::uuid
          and l.status = 'draft')
        or (l.id = 'e703eea0-75c4-4c12-a100-000000000303'::uuid
          and l.version_id = 'e703eea0-75c4-4c12-a100-000000000203'::uuid
          and l.status = 'archived')
      )
  ) then
    raise exception 'Unexpected or modified listings reference disposable fixture recordings; cleanup stopped.';
  end if;

  if exists (
    select 1
    from public.licenses as lic
    join public.listings as l on l.id = lic.listing_id
    join public.voice_versions as v on v.id = l.version_id
    where v.recording_id = any(v_all_recording_ids)
  ) or exists (
    select 1
    from public.reports as rep
    join public.listings as l on l.id = rep.listing_id
    join public.voice_versions as v on v.id = l.version_id
    where v.recording_id = any(v_all_recording_ids)
  ) then
    raise exception 'Unexpected licenses or reports reference disposable fixtures; review them manually and do not auto-delete user data.';
  end if;

  if exists (
    select 1
    from public.voice_recordings as r
    join public.voice_versions as v on v.recording_id = r.id
    join storage.objects as o
      on o.bucket_id = 'voice-files'
     and o.name = v.storage_path
    where r.owner_id = v_user_a_id
      and r.title like 'RLS API verification %'
      and r.description = 'Disposable private API RLS test fixture.'
      and r.visibility = 'private'
  ) then
    raise exception 'An older API fixture unexpectedly references a real Storage object; cleanup stopped.';
  end if;

  if exists (
    select 1
    from public.voice_recordings as r
    join public.voice_versions as v on v.recording_id = r.id
    where r.owner_id = v_user_a_id
      and r.title like 'RLS Storage API verification %'
      and r.description = 'Disposable private original Storage API fixture.'
      and r.visibility = 'private'
      and (
        v.effect_type <> 'original'
        or v.storage_path !~ (
          '^' || v_user_a_id::text ||
          '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.](wav|mp3|m4a|ogg|webm)$'
        )
      )
  ) then
    raise exception 'A marked Storage fixture has an unexpected version or path; cleanup stopped.';
  end if;

  select coalesce(
    pg_catalog.array_agg(v.storage_path order by v.storage_path),
    array[]::text[]
  )
    into v_storage_paths
  from public.voice_recordings as r
  join public.voice_versions as v on v.recording_id = r.id
  where r.owner_id = v_user_a_id
    and r.title like 'RLS Storage API verification %'
    and r.description = 'Disposable private original Storage API fixture.'
    and r.visibility = 'private'
    and v.effect_type = 'original';

  raise notice 'After this metadata cleanup succeeds, remove only these now-unreferenced paths through User A authorized Storage access: %',
    v_storage_paths;

  delete from public.listings as l
  where l.id = any(v_listing_ids);

  delete from public.voice_versions as v
  where v.recording_id = any(v_all_recording_ids);

  delete from public.voice_recordings as r
  where r.id = any(v_recording_ids)
    and r.owner_id = v_seller_id
    and r.title like 'RLS API fixture DEV - %';

  delete from public.voice_recordings as r
  where r.id = any(v_all_recording_ids)
    and r.owner_id = v_user_a_id
    and (
      (
        r.title like 'RLS API verification %'
        and r.description = 'Disposable private API RLS test fixture.'
      )
      or (
        r.title like 'RLS Storage API verification %'
        and r.description = 'Disposable private original Storage API fixture.'
      )
    )
    and r.visibility = 'private';

  raise notice 'Development RLS API metadata fixtures were removed. Reports/licenses were required to be absent; no Storage objects were deleted.';
end;
$rls_api_fixture_cleanup$;
