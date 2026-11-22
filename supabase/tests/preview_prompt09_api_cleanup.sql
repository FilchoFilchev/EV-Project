-- READ ONLY. Run in the echovault-dev SQL Editor before any cleanup.
-- These queries preview only the explicit Prompt 09 API test allowlists and
-- preservation targets; they perform no writes or deletes.

with allowlist(recording_id, owner_id, expected_title, expected_description, expected_versions) as (
  values
    ('297bea17-e841-4cad-84b0-e96d8fdde236'::uuid, '207f9dbf-ae7e-42eb-9925-9fb371724e97'::uuid,
     'RLS API verification 63d3d0b1-0019-4f97-b1a2-504ef046c0f7',
     'Disposable private API RLS test fixture.', 0),
    ('c5a34b01-7dc5-40e2-863d-4fa3f13a23c5'::uuid, '207f9dbf-ae7e-42eb-9925-9fb371724e97'::uuid,
     'RLS API verification 2a56af8f-38a0-4468-88b0-fa65f17b4925',
     'Disposable private API RLS test fixture.', 0),
    ('a711c757-e656-4b0f-8faf-1fda7be29674'::uuid, '207f9dbf-ae7e-42eb-9925-9fb371724e97'::uuid,
     'RLS Storage API verification 4088509c-eff4-40c1-9ef3-93deabd3ef6c',
     'Disposable private original Storage API fixture.', 1),
    ('65541acc-4b87-40bb-b3d5-1833babd92f4'::uuid, '207f9dbf-ae7e-42eb-9925-9fb371724e97'::uuid,
     'RLS Storage API verification 7e860eb6-3d01-466f-8211-c007d6b6dade',
     'Disposable private original Storage API fixture.', 1)
)
select
  a.recording_id,
  (r.id is not null) as recording_exists,
  r.owner_id,
  r.title,
  r.description,
  r.category,
  r.visibility,
  count(v.id)::integer as version_count,
  coalesce(
    array_agg(v.id order by v.id) filter (where v.id is not null),
    array[]::uuid[]
  ) as version_ids,
  coalesce(
    r.id is not null
    and r.owner_id = a.owner_id
    and r.title = a.expected_title
    and r.description = a.expected_description
    and r.category = 'test'
    and r.visibility = 'private'
    and count(v.id) = a.expected_versions,
    false
  ) as exact_allowlist_match
from allowlist a
left join public.voice_recordings r on r.id = a.recording_id
left join public.voice_versions v on v.recording_id = r.id
group by a.recording_id, a.owner_id, a.expected_title, a.expected_description,
         a.expected_versions, r.id, r.owner_id, r.title, r.description,
         r.category, r.visibility
order by a.recording_id;

with expected(path, version_id) as (
  values
    ('207f9dbf-ae7e-42eb-9925-9fb371724e97/50b95405-ef0a-443e-8a97-ff22c54b494c.wav',
     'a180f71c-2d78-4c1a-94d3-25c6ab94c622'::uuid),
    ('207f9dbf-ae7e-42eb-9925-9fb371724e97/8442bc07-26fa-4725-9c04-76875e8ba7ce.wav',
     '9d23ce99-e5a3-4431-9883-dd20fc45a996'::uuid)
)
select
  e.path,
  e.version_id,
  (o.name is not null) as object_exists,
  o.metadata ->> 'size' as object_size_bytes,
  pg_catalog.lower(pg_catalog.split_part(
    coalesce(o.metadata ->> 'mimetype', ''), ';', 1
  )) as object_mime,
  count(v.id)::integer as all_database_path_references,
  coalesce(
    array_agg(v.id order by v.id) filter (where v.id is not null),
    array[]::uuid[]
  ) as referencing_version_ids,
  coalesce(
    array_agg(v.recording_id order by v.recording_id) filter (where v.id is not null),
    array[]::uuid[]
  ) as referencing_recording_ids,
  coalesce(bool_or(v.id = e.version_id), false) as expected_version_references_path,
  (select count(*) from public.listings as l where l.version_id = e.version_id) as listing_references,
  (select count(*)
   from public.licenses as license
   join public.listings as l on l.id = license.listing_id
   where l.version_id = e.version_id) as license_references,
  (select count(*)
   from public.reports as report
   join public.listings as l on l.id = report.listing_id
   where l.version_id = e.version_id) as report_references
from expected e
left join storage.objects as o
  on o.bucket_id = 'voice-files' and o.name = e.path
left join public.voice_versions as v on v.storage_path = e.path
group by e.path, e.version_id, o.name, o.metadata
order by e.path;

select id, owner_id, title, description, category, visibility, created_at, updated_at
from public.voice_recordings
where title = 'Test'
order by owner_id, created_at, id;

with expected(recording_id, version_id, listing_id, owner_id, status) as (
  values
    ('e703eea0-75c4-4c12-a100-000000000101'::uuid,
     'e703eea0-75c4-4c12-a100-000000000201'::uuid,
     'e703eea0-75c4-4c12-a100-000000000301'::uuid,
     'c0dceda7-3f18-4ba2-986c-df58f387f01c'::uuid, 'published'),
    ('e703eea0-75c4-4c12-a100-000000000102'::uuid,
     'e703eea0-75c4-4c12-a100-000000000202'::uuid,
     'e703eea0-75c4-4c12-a100-000000000302'::uuid,
     'c0dceda7-3f18-4ba2-986c-df58f387f01c'::uuid, 'draft'),
    ('e703eea0-75c4-4c12-a100-000000000103'::uuid,
     'e703eea0-75c4-4c12-a100-000000000203'::uuid,
     'e703eea0-75c4-4c12-a100-000000000303'::uuid,
     'c0dceda7-3f18-4ba2-986c-df58f387f01c'::uuid, 'archived')
)
select
  e.recording_id,
  r.owner_id,
  r.title,
  r.description,
  r.category,
  r.visibility,
  v.id as version_id,
  v.effect_type,
  v.storage_path,
  v.duration_seconds,
  v.mime_type,
  v.file_size_bytes,
  l.id as listing_id,
  l.status,
  l.preview_path,
  l.sale_price_cents,
  l.rental_price_cents,
  l.rental_days,
  l.currency,
  coalesce(r.owner_id = e.owner_id and l.status = e.status, false) as expected_fixture_match
from expected e
left join public.voice_recordings as r on r.id = e.recording_id
left join public.voice_versions as v
  on v.id = e.version_id and v.recording_id = e.recording_id
left join public.listings as l
  on l.id = e.listing_id and l.version_id = e.version_id
order by e.recording_id;
