-- DEVELOPMENT ONLY. Review and run only in echovault-dev after explicit approval.
-- This transaction removes exactly four verified User A test recordings and
-- two original versions. It never deletes Storage objects or marketplace data.
-- If any guard raises an exception, the transaction is not committed; issue
-- ROLLBACK in the SQL Editor session and stop for review.

begin;
set transaction isolation level serializable;

create temporary table prompt09_cleanup_recording_allowlist (
  recording_id uuid primary key,
  owner_id uuid not null,
  expected_title text not null,
  expected_description text not null,
  expected_category text not null,
  expected_visibility text not null,
  expected_version_count integer not null
) on commit drop;

insert into prompt09_cleanup_recording_allowlist
  (recording_id, owner_id, expected_title, expected_description,
   expected_category, expected_visibility, expected_version_count)
values
  ('297bea17-e841-4cad-84b0-e96d8fdde236',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97',
   'RLS API verification 63d3d0b1-0019-4f97-b1a2-504ef046c0f7',
   'Disposable private API RLS test fixture.', 'test', 'private', 0),
  ('c5a34b01-7dc5-40e2-863d-4fa3f13a23c5',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97',
   'RLS API verification 2a56af8f-38a0-4468-88b0-fa65f17b4925',
   'Disposable private API RLS test fixture.', 'test', 'private', 0),
  ('a711c757-e656-4b0f-8faf-1fda7be29674',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97',
   'RLS Storage API verification 4088509c-eff4-40c1-9ef3-93deabd3ef6c',
   'Disposable private original Storage API fixture.', 'test', 'private', 1),
  ('65541acc-4b87-40bb-b3d5-1833babd92f4',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97',
   'RLS Storage API verification 7e860eb6-3d01-466f-8211-c007d6b6dade',
   'Disposable private original Storage API fixture.', 'test', 'private', 1);

create temporary table prompt09_cleanup_version_allowlist (
  version_id uuid primary key,
  recording_id uuid not null,
  storage_path text not null unique,
  effect_type text not null,
  effect_settings jsonb not null,
  duration_seconds numeric not null,
  mime_type text not null,
  file_size_bytes bigint not null
) on commit drop;

insert into prompt09_cleanup_version_allowlist
  (version_id, recording_id, storage_path, effect_type, effect_settings,
   duration_seconds, mime_type, file_size_bytes)
values
  ('a180f71c-2d78-4c1a-94d3-25c6ab94c622',
   'a711c757-e656-4b0f-8faf-1fda7be29674',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97/50b95405-ef0a-443e-8a97-ff22c54b494c.wav',
   'original', '{}'::jsonb, 1.25, 'audio/wav', 20044),
  ('9d23ce99-e5a3-4431-9883-dd20fc45a996',
   '65541acc-4b87-40bb-b3d5-1833babd92f4',
   '207f9dbf-ae7e-42eb-9925-9fb371724e97/8442bc07-26fa-4725-9c04-76875e8ba7ce.wav',
   'original', '{}'::jsonb, 1.25, 'audio/wav', 20044);

create temporary table prompt09_cleanup_marketplace_allowlist (
  recording_id uuid primary key,
  version_id uuid not null unique,
  listing_id uuid not null unique,
  owner_id uuid not null,
  recording_title text not null,
  storage_path text not null,
  listing_status text not null,
  preview_path text not null,
  sale_price_cents integer not null,
  rental_price_cents integer
) on commit drop;

insert into prompt09_cleanup_marketplace_allowlist
  (recording_id, version_id, listing_id, owner_id, recording_title,
   storage_path, listing_status, preview_path, sale_price_cents, rental_price_cents)
values
  ('e703eea0-75c4-4c12-a100-000000000101',
   'e703eea0-75c4-4c12-a100-000000000201',
   'e703eea0-75c4-4c12-a100-000000000301',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c',
   'RLS API fixture DEV - published source',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-published.placeholder',
   'published',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-published.preview',
   1200, 300),
  ('e703eea0-75c4-4c12-a100-000000000102',
   'e703eea0-75c4-4c12-a100-000000000202',
   'e703eea0-75c4-4c12-a100-000000000302',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c',
   'RLS API fixture DEV - draft source',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-draft.placeholder',
   'draft',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-draft.preview',
   1200, null),
  ('e703eea0-75c4-4c12-a100-000000000103',
   'e703eea0-75c4-4c12-a100-000000000203',
   'e703eea0-75c4-4c12-a100-000000000303',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c',
   'RLS API fixture DEV - archived source',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-archived.placeholder',
   'archived',
   'c0dceda7-3f18-4ba2-986c-df58f387f01c/rls-api-test-fixture-archived.preview',
   1200, null);

create temporary table prompt09_cleanup_test_snapshot on commit drop as
select pg_catalog.to_jsonb(r) as row_data
from public.voice_recordings as r
where r.title = 'Test';

create temporary table prompt09_cleanup_marketplace_snapshot on commit drop as
select pg_catalog.jsonb_build_object(
  'recording', pg_catalog.to_jsonb(r),
  'version', pg_catalog.to_jsonb(v),
  'listing', pg_catalog.to_jsonb(l)
) as row_data
from pg_temp.prompt09_cleanup_marketplace_allowlist as a
join public.voice_recordings as r
  on r.id = a.recording_id
join public.voice_versions as v
  on v.id = a.version_id
 and v.recording_id = r.id
join public.listings as l
  on l.id = a.listing_id
 and l.version_id = v.id;

do $cleanup$
declare
  v_owner_id constant uuid := '207f9dbf-ae7e-42eb-9925-9fb371724e97';
  v_affected integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role_info
    where role_info.rolname = current_user
      and (role_info.rolsuper or role_info.rolbypassrls)
  ) then
    raise exception 'Cleanup requires a trusted development SQL Editor role.';
  end if;

  perform 1
  from public.voice_recordings as r
  join pg_temp.prompt09_cleanup_recording_allowlist as a
    on a.recording_id = r.id
  for update of r;

  perform 1
  from public.voice_versions as v
  join pg_temp.prompt09_cleanup_version_allowlist as a
    on a.version_id = v.id
  for update of v;

  perform 1
  from public.voice_recordings as r
  where r.title = 'Test'
  for update of r;

  perform 1
  from pg_temp.prompt09_cleanup_marketplace_allowlist as a
  join public.voice_recordings as r on r.id = a.recording_id
  join public.voice_versions as v on v.id = a.version_id
  join public.listings as l on l.id = a.listing_id
  for update of r, v, l;

  if (select count(*) from pg_temp.prompt09_cleanup_recording_allowlist) <> 4
     or (select count(*) from pg_temp.prompt09_cleanup_version_allowlist) <> 2
     or (select count(*) from pg_temp.prompt09_cleanup_marketplace_allowlist) <> 3
  then
    raise exception 'The cleanup allowlists are incomplete; no rows were removed.';
  end if;

  if exists (
    select 1
    from pg_temp.prompt09_cleanup_recording_allowlist as a
    left join public.voice_recordings as r on r.id = a.recording_id
    where r.id is null
       or r.owner_id is distinct from a.owner_id
       or r.owner_id is distinct from v_owner_id
       or r.title is distinct from a.expected_title
       or r.description is distinct from a.expected_description
       or r.category is distinct from a.expected_category
       or r.visibility is distinct from a.expected_visibility
       or (select count(*) from public.voice_versions as v
           where v.recording_id = a.recording_id) <> a.expected_version_count
  ) then
    raise exception 'A recording row, owner, marker, visibility, category, or version count differs from the allowlist.';
  end if;

  if exists (
    select 1
    from public.voice_recordings as r
    where r.owner_id = v_owner_id
      and (
        r.title like 'RLS API verification %'
        or r.title like 'RLS Storage API verification %'
      )
      and not exists (
        select 1
        from pg_temp.prompt09_cleanup_recording_allowlist as a
        where a.recording_id = r.id
      )
  ) then
    raise exception 'An additional User A API-test marker row exists outside the explicit allowlist.';
  end if;

  if (select count(*)
      from public.voice_versions as v
      join pg_temp.prompt09_cleanup_recording_allowlist as a
        on a.recording_id = v.recording_id) <> 2
     or (select count(*)
         from public.voice_versions as v
         join pg_temp.prompt09_cleanup_version_allowlist as a
           on a.version_id = v.id) <> 2
  then
    raise exception 'The candidate recordings do not have exactly the two allowlisted versions.';
  end if;

  if exists (
    select 1
    from pg_temp.prompt09_cleanup_version_allowlist as a
    left join public.voice_versions as v on v.id = a.version_id
    where v.id is null
       or v.recording_id is distinct from a.recording_id
       or v.storage_path is distinct from a.storage_path
       or v.effect_type is distinct from a.effect_type
       or v.effect_settings is distinct from a.effect_settings
       or v.duration_seconds is distinct from a.duration_seconds
       or v.mime_type is distinct from a.mime_type
       or v.file_size_bytes is distinct from a.file_size_bytes
  ) then
    raise exception 'An original-version row differs from its explicit ID, recording, path, MIME, size, or duration.';
  end if;

  if exists (
    select 1
    from pg_temp.prompt09_cleanup_version_allowlist as a
    where (select count(*) from public.voice_versions as v
           where v.storage_path = a.storage_path) <> 1
       or not exists (
         select 1
         from public.voice_versions as v
         where v.id = a.version_id
           and v.recording_id = a.recording_id
           and v.storage_path = a.storage_path
       )
  ) then
    raise exception 'A Storage path has a missing or unexpected database reference.';
  end if;

  if (select count(*)
      from storage.objects as o
      join pg_temp.prompt09_cleanup_version_allowlist as a
        on a.storage_path = o.name
       and o.bucket_id = 'voice-files'
      where o.metadata ->> 'size' = a.file_size_bytes::text
        and pg_catalog.lower(pg_catalog.split_part(
              coalesce(o.metadata ->> 'mimetype', ''), ';', 1
            )) = a.mime_type) <> 2
  then
    raise exception 'A private Storage object is missing or its bucket, exact path, MIME, or size differs from the allowlist.';
  end if;

  if exists (
    select 1
    from public.listings as l
    join pg_temp.prompt09_cleanup_version_allowlist as a on a.version_id = l.version_id
  ) or exists (
    select 1
    from public.licenses as license
    join public.listings as l on l.id = license.listing_id
    join pg_temp.prompt09_cleanup_version_allowlist as a on a.version_id = l.version_id
  ) or exists (
    select 1
    from public.reports as report
    join public.listings as l on l.id = report.listing_id
    join pg_temp.prompt09_cleanup_version_allowlist as a on a.version_id = l.version_id
  ) then
    raise exception 'A candidate version has a listing, license, or report dependency.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_info
    where constraint_info.contype = 'f'
      and (
        (constraint_info.confrelid = 'public.voice_recordings'::regclass
         and constraint_info.conrelid <> 'public.voice_versions'::regclass)
        or (constraint_info.confrelid = 'public.voice_versions'::regclass
            and constraint_info.conrelid <> 'public.listings'::regclass)
        or (constraint_info.confrelid = 'public.listings'::regclass
            and constraint_info.conrelid not in (
              'public.licenses'::regclass,
              'public.reports'::regclass
            ))
      )
  ) then
    raise exception 'An unexpected foreign-key dependency exists; cleanup stopped.';
  end if;

  if (select count(*) from pg_temp.prompt09_cleanup_test_snapshot) = 0 then
    raise exception 'No recording titled Test was captured for preservation verification.';
  end if;

  if (select count(*) from pg_temp.prompt09_cleanup_marketplace_snapshot) <> 3
     or exists (
       select 1
       from pg_temp.prompt09_cleanup_marketplace_allowlist as a
       left join public.voice_recordings as r on r.id = a.recording_id
       left join public.voice_versions as v
         on v.id = a.version_id and v.recording_id = a.recording_id
       left join public.listings as l
         on l.id = a.listing_id and l.version_id = a.version_id
       where r.id is null
          or r.owner_id is distinct from a.owner_id
          or r.title is distinct from a.recording_title
          or r.category is distinct from 'rls-test'
          or r.visibility is distinct from 'public'
          or v.id is null
          or v.effect_type is distinct from 'original'
          or v.effect_settings is distinct from '{}'::jsonb
          or v.storage_path is distinct from a.storage_path
          or v.duration_seconds is distinct from 1
          or v.mime_type is distinct from 'audio/wav'
          or v.file_size_bytes is distinct from 1024
          or l.id is null
          or l.status is distinct from a.listing_status
          or l.preview_path is distinct from a.preview_path
          or l.sale_price_cents is distinct from a.sale_price_cents
          or l.rental_price_cents is distinct from a.rental_price_cents
          or l.rental_days is distinct from 30
          or l.currency is distinct from 'EUR'
     )
  then
    raise exception 'The preservation snapshot does not contain the three exact marketplace fixtures.';
  end if;

  delete from public.voice_versions as v
  using pg_temp.prompt09_cleanup_version_allowlist as a
  where v.id = a.version_id
    and v.recording_id = a.recording_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 2 then
    raise exception 'Expected to delete exactly two allowlisted original versions; deleted %.', v_affected;
  end if;

  delete from public.voice_recordings as r
  using pg_temp.prompt09_cleanup_recording_allowlist as a
  where r.id = a.recording_id
    and r.owner_id = a.owner_id
    and r.title = a.expected_title
    and r.description = a.expected_description
    and r.category = a.expected_category
    and r.visibility = a.expected_visibility;
  get diagnostics v_affected = row_count;
  if v_affected <> 4 then
    raise exception 'Expected to delete exactly four allowlisted API recordings; deleted %.', v_affected;
  end if;

  if exists (
    select 1
    from pg_temp.prompt09_cleanup_recording_allowlist as a
    join public.voice_recordings as r on r.id = a.recording_id
  ) or exists (
    select 1
    from pg_temp.prompt09_cleanup_version_allowlist as a
    join public.voice_versions as v on v.id = a.version_id
  ) or exists (
    select 1
    from public.voice_versions as v
    join pg_temp.prompt09_cleanup_version_allowlist as a on a.storage_path = v.storage_path
  ) then
    raise exception 'Allowlisted metadata or Storage-path references remain after deletion.';
  end if;

  if (select count(*)
      from storage.objects as o
      join pg_temp.prompt09_cleanup_version_allowlist as a
        on o.bucket_id = 'voice-files' and o.name = a.storage_path) <> 2
  then
    raise exception 'The two Storage objects must remain for authenticated Storage API removal.';
  end if;

  if exists (
    select row_data
    from pg_temp.prompt09_cleanup_test_snapshot
    except
    select pg_catalog.to_jsonb(r)
    from public.voice_recordings as r
    where r.title = 'Test'
  ) or exists (
    select pg_catalog.to_jsonb(r)
    from public.voice_recordings as r
    where r.title = 'Test'
    except
    select row_data
    from pg_temp.prompt09_cleanup_test_snapshot
  ) then
    raise exception 'A recording titled Test changed during cleanup; transaction aborted.';
  end if;

  if exists (
    select row_data
    from pg_temp.prompt09_cleanup_marketplace_snapshot
    except
    select pg_catalog.jsonb_build_object(
      'recording', pg_catalog.to_jsonb(r),
      'version', pg_catalog.to_jsonb(v),
      'listing', pg_catalog.to_jsonb(l)
    )
    from pg_temp.prompt09_cleanup_marketplace_allowlist as a
    join public.voice_recordings as r on r.id = a.recording_id
    join public.voice_versions as v
      on v.id = a.version_id and v.recording_id = r.id
    join public.listings as l
      on l.id = a.listing_id and l.version_id = v.id
  ) or exists (
    select pg_catalog.jsonb_build_object(
      'recording', pg_catalog.to_jsonb(r),
      'version', pg_catalog.to_jsonb(v),
      'listing', pg_catalog.to_jsonb(l)
    )
    from pg_temp.prompt09_cleanup_marketplace_allowlist as a
    join public.voice_recordings as r on r.id = a.recording_id
    join public.voice_versions as v
      on v.id = a.version_id and v.recording_id = r.id
    join public.listings as l
      on l.id = a.listing_id and l.version_id = v.id
    except
    select row_data
    from pg_temp.prompt09_cleanup_marketplace_snapshot
  ) then
    raise exception 'A marketplace fixture changed during cleanup; transaction aborted.';
  end if;

  raise notice 'Exactly four allowlisted User A recordings and two versions were deleted. Both Storage objects and all marketplace fixtures remain unchanged.';
end;
$cleanup$;

commit;
