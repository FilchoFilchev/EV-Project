-- DEVELOPMENT ONLY. Never run this script in production.
-- Before execution, confirm the Supabase Dashboard is set to echovault-dev and
-- compare its project reference with SUPABASE_TEST_URL in .env.rls-test.local.
-- SQL Editor does not expose a reliable project slug to this script.
--
-- Replace both NULL UUID placeholders below with the disposable RLS User B
-- (seller) and User A (buyer) UUIDs from Authentication > Users. Do not
-- change their roles or subscriptions.
--
-- These rows contain placeholder paths only. No Storage objects are created.
-- A successful DO statement persists its rows; do not wrap it in a rollback.

do $rls_api_fixture_setup$
declare
  v_seller_id constant uuid := 'c0dceda7-3f18-4ba2-986c-df58f387f01c';
  v_buyer_id constant uuid := '207f9dbf-ae7e-42eb-9925-9fb371724e97';

  v_recording_published constant uuid := 'e703eea0-75c4-4c12-a100-000000000101';
  v_recording_draft constant uuid := 'e703eea0-75c4-4c12-a100-000000000102';
  v_recording_archived constant uuid := 'e703eea0-75c4-4c12-a100-000000000103';

  v_version_published constant uuid := 'e703eea0-75c4-4c12-a100-000000000201';
  v_version_draft constant uuid := 'e703eea0-75c4-4c12-a100-000000000202';
  v_version_archived constant uuid := 'e703eea0-75c4-4c12-a100-000000000203';

  v_listing_published constant uuid := 'e703eea0-75c4-4c12-a100-000000000301';
  v_listing_draft constant uuid := 'e703eea0-75c4-4c12-a100-000000000302';
  v_listing_archived constant uuid := 'e703eea0-75c4-4c12-a100-000000000303';
begin
  if v_seller_id is null or v_buyer_id is null then
    raise exception 'Replace both UUID placeholders with disposable RLS User B and User A UUIDs.';
  end if;
  if v_seller_id = v_buyer_id then
    raise exception 'The fixture seller and buyer must be different test accounts.';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    join public.user_roles as ur on ur.user_id = p.id
    where p.id = v_seller_id
      and ur.role = 'user'
  ) then
    raise exception 'Fixture seller must be an existing standard User B profile.';
  end if;
  if not exists (
    select 1
    from public.profiles as p
    join public.user_roles as ur on ur.user_id = p.id
    where p.id = v_buyer_id
      and ur.role = 'user'
  ) then
    raise exception 'Fixture buyer must be an existing standard User A profile.';
  end if;

  insert into public.voice_recordings
    (id, owner_id, title, description, category, visibility)
  values
    (v_recording_published, v_seller_id, 'RLS API fixture DEV - published source',
     'Development RLS fixture only; no real audio file.', 'rls-test', 'public'),
    (v_recording_draft, v_seller_id, 'RLS API fixture DEV - draft source',
     'Development RLS fixture only; no real audio file.', 'rls-test', 'public'),
    (v_recording_archived, v_seller_id, 'RLS API fixture DEV - archived source',
     'Development RLS fixture only; no real audio file.', 'rls-test', 'public')
  on conflict (id) do nothing;

  insert into public.voice_versions
    (id, recording_id, effect_type, effect_settings, storage_path,
     duration_seconds, mime_type, file_size_bytes)
  values
    (v_version_published, v_recording_published, 'original', '{}'::jsonb,
     v_seller_id::text || '/rls-api-test-fixture-published.placeholder',
     1, 'audio/wav', 1024),
    (v_version_draft, v_recording_draft, 'original', '{}'::jsonb,
     v_seller_id::text || '/rls-api-test-fixture-draft.placeholder',
     1, 'audio/wav', 1024),
    (v_version_archived, v_recording_archived, 'original', '{}'::jsonb,
     v_seller_id::text || '/rls-api-test-fixture-archived.placeholder',
     1, 'audio/wav', 1024)
  on conflict (id) do nothing;

  insert into public.listings
    (id, version_id, status, sale_price_cents, rental_price_cents,
     rental_days, currency, preview_path)
  values
    (v_listing_published, v_version_published, 'published', 1200, 300,
     30, 'EUR', v_seller_id::text || '/rls-api-test-fixture-published.preview'),
    (v_listing_draft, v_version_draft, 'draft', 1200, null,
     30, 'EUR', v_seller_id::text || '/rls-api-test-fixture-draft.preview'),
    (v_listing_archived, v_version_archived, 'archived', 1200, null,
     30, 'EUR', v_seller_id::text || '/rls-api-test-fixture-archived.preview')
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.voice_recordings as r
    join public.voice_versions as v on v.recording_id = r.id
    join public.listings as l on l.version_id = v.id
    where r.id = v_recording_published
      and r.owner_id = v_seller_id
      and r.title = 'RLS API fixture DEV - published source'
      and r.visibility = 'public'
      and v.id = v_version_published
      and v.effect_type = 'original'
      and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-published.placeholder'
      and l.id = v_listing_published
      and l.status = 'published'
      and l.sale_price_cents = 1200
      and l.rental_price_cents = 300
      and l.preview_path = v_seller_id::text || '/rls-api-test-fixture-published.preview'
  ) or not exists (
    select 1
    from public.voice_recordings as r
    join public.voice_versions as v on v.recording_id = r.id
    join public.listings as l on l.version_id = v.id
    where r.id = v_recording_draft
      and r.owner_id = v_seller_id
      and r.title = 'RLS API fixture DEV - draft source'
      and r.visibility = 'public'
      and v.id = v_version_draft
      and v.effect_type = 'original'
      and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-draft.placeholder'
      and l.id = v_listing_draft
      and l.status = 'draft'
      and l.sale_price_cents = 1200
      and l.preview_path = v_seller_id::text || '/rls-api-test-fixture-draft.preview'
  ) or not exists (
    select 1
    from public.voice_recordings as r
    join public.voice_versions as v on v.recording_id = r.id
    join public.listings as l on l.version_id = v.id
    where r.id = v_recording_archived
      and r.owner_id = v_seller_id
      and r.title = 'RLS API fixture DEV - archived source'
      and r.visibility = 'public'
      and v.id = v_version_archived
      and v.effect_type = 'original'
      and v.storage_path = v_seller_id::text || '/rls-api-test-fixture-archived.placeholder'
      and l.id = v_listing_archived
      and l.status = 'archived'
      and l.sale_price_cents = 1200
      and l.preview_path = v_seller_id::text || '/rls-api-test-fixture-archived.preview'
  ) then
    raise exception 'Fixture IDs already exist with unexpected data; no fixture changes were committed.';
  end if;

  raise notice 'Development RLS API fixtures created or verified for the designated seller.';
end;
$rls_api_fixture_setup$;
