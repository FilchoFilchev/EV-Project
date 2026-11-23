-- Prompt 13. Forward-only: existing recordings, listings, licenses, and objects
-- are preserved. Legacy fixture previews are not rewritten or revalidated.
alter table public.listings add column preview_duration_seconds numeric;
grant select (preview_duration_seconds) on public.listings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-previews', 'voice-previews', true, 256044, array['audio/wav'])
on conflict (id) do nothing;

do $bucket_check$
begin
  if not exists (
    select 1 from storage.buckets as b
    where b.id = 'voice-previews' and b.name = 'voice-previews'
      and b.public is true and b.file_size_limit = 256044
      and b.allowed_mime_types = array['audio/wav']
  ) then
    raise exception 'The voice-previews bucket has incompatible settings; review it without overwriting existing settings or data.';
  end if;
end;
$bucket_check$;

-- Canonical previews are PCM16 mono 16000 Hz WAVs: 44 header bytes plus
-- 32000 bytes per second. Storage enforces MIME/size; the browser generates
-- and validates actual WAV content. SQL cannot decode uploaded media bytes.
create function private.can_upload_voice_preview(p_name text, p_metadata jsonb)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and p_name ~ (
      '^' || (select auth.uid())::text ||
      '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]wav$'
    )
    and pg_catalog.lower(pg_catalog.split_part(coalesce(p_metadata ->> 'mimetype', ''), ';', 1)) = 'audio/wav'
    and case when p_metadata ->> 'size' ~ '^[0-9]{6}$'
      then (p_metadata ->> 'size')::bigint between 160044 and 256044
        and ((p_metadata ->> 'size')::bigint - 44) % 2 = 0
      else false
    end;
$function$;

create function private.can_delete_unreferenced_preview(p_path text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_unreferenced boolean;
begin
  if (select auth.uid()) is null or p_path is null
    or pg_catalog.split_part(p_path, '/', 1) is distinct from (select auth.uid())::text
  then
    return false;
  end if;
  -- Publication and cleanup serialize on the same preview. This VOLATILE
  -- function checks references in a separate SPI query after acquiring the
  -- lock, so READ COMMITTED observes a publication committed during the wait.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('voice-previews/' || p_path, 0)
  );
  select not exists (select 1 from public.listings as l where l.preview_path = p_path)
    into v_unreferenced;
  return v_unreferenced;
end;
$function$;

revoke all on function private.can_upload_voice_preview(text, jsonb) from public, anon, authenticated;
revoke all on function private.can_delete_unreferenced_preview(text) from public, anon, authenticated;
grant execute on function private.can_upload_voice_preview(text, jsonb) to authenticated;
grant execute on function private.can_delete_unreferenced_preview(text) to authenticated;

create policy voice_previews_select_owner on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'voice-previews' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy voice_previews_select_scope on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'voice-previews' or (storage.foldername(name))[1] = (select auth.uid())::text);
create policy voice_previews_select_deny_anon on storage.objects
  as restrictive for select to anon using (bucket_id <> 'voice-previews');

create policy voice_previews_insert_owner on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'voice-previews' and private.can_upload_voice_preview(name, metadata));
create policy voice_previews_insert_scope on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'voice-previews' or private.can_upload_voice_preview(name, metadata));
create policy voice_previews_insert_deny_anon on storage.objects
  as restrictive for insert to anon with check (bucket_id <> 'voice-previews');

create policy voice_previews_no_update on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id <> 'voice-previews') with check (bucket_id <> 'voice-previews');

create policy voice_previews_delete_unreferenced_owner on storage.objects
  as permissive for delete to authenticated
  using (bucket_id = 'voice-previews' and private.can_delete_unreferenced_preview(name));
create policy voice_previews_delete_scope on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'voice-previews' or private.can_delete_unreferenced_preview(name));
create policy voice_previews_delete_deny_anon on storage.objects
  as restrictive for delete to anon using (bucket_id <> 'voice-previews');

-- Publication has one checked entry point. Revoking table privileges alone
-- would leave the previous column grants intact, so revoke both explicitly.
revoke insert, update on table public.listings from authenticated;
revoke insert (version_id, status, sale_price_cents, rental_price_cents,
  rental_days, currency, preview_path) on public.listings from authenticated;
revoke update (status, sale_price_cents, rental_price_cents, rental_days,
  currency, preview_path) on public.listings from authenticated;
grant update (status) on public.listings to authenticated;

drop policy listings_insert on public.listings;
drop policy listings_update on public.listings;
create policy listings_owner_archive on public.listings
  for update to authenticated
  using (private.owns_version(version_id))
  with check (private.owns_version(version_id) and status = 'archived');

create function private.valid_listing_preview(
  p_version_id uuid, p_preview_path text, p_duration numeric
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and p_duration between 5 and 8
    and p_duration * 16000 = pg_catalog.trunc(p_duration * 16000)
    and p_preview_path ~ (
      '^' || (select auth.uid())::text ||
      '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]wav$'
    )
    and exists (
      select 1 from public.voice_versions as v
      join public.voice_recordings as r on r.id = v.recording_id
      join storage.objects as full_audio
        on full_audio.bucket_id = 'voice-files' and full_audio.name = v.storage_path
      join storage.objects as preview
        on preview.bucket_id = 'voice-previews' and preview.name = p_preview_path
      where v.id = p_version_id and r.owner_id = (select auth.uid())
        and pg_catalog.split_part(v.storage_path, '/', 1) = (select auth.uid())::text
        and v.file_size_bytes between 1 and 20971520
        and v.duration_seconds >= p_duration
        and full_audio.metadata ->> 'size' = v.file_size_bytes::text
        and pg_catalog.lower(pg_catalog.split_part(coalesce(full_audio.metadata ->> 'mimetype', ''), ';', 1)) = v.mime_type
        and pg_catalog.lower(pg_catalog.split_part(coalesce(preview.metadata ->> 'mimetype', ''), ';', 1)) = 'audio/wav'
        and preview.metadata ->> 'size' = (44 + p_duration * 32000)::bigint::text
    );
$function$;

revoke all on function private.valid_listing_preview(uuid, text, numeric) from public, anon, authenticated;

create function public.publish_voice_listing(
  p_version_id uuid,
  p_preview_path text,
  p_preview_duration_seconds numeric,
  p_sale_price_cents integer,
  p_rental_price_cents integer,
  p_make_public boolean,
  p_rights_confirmed boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_recording_id uuid;
  v_listing_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  if p_make_public is distinct from true or p_rights_confirmed is distinct from true then
    raise exception using errcode = '22023', message = 'Confirm public source metadata and your rights to publish this voice.';
  end if;
  if (p_sale_price_cents is null and p_rental_price_cents is null)
    or (p_sale_price_cents is not null and p_sale_price_cents <= 0)
    or (p_rental_price_cents is not null and p_rental_price_cents <= 0)
  then
    raise exception using errcode = '22023', message = 'Choose at least one positive euro-cent price.';
  end if;
  if p_preview_duration_seconds is null
    or p_preview_duration_seconds not between 5 and 8
    or p_preview_duration_seconds * 16000 <> pg_catalog.trunc(p_preview_duration_seconds * 16000)
  then
    raise exception using errcode = '22023', message = 'Preview duration must be 5–8 seconds with a whole number of 16000 Hz samples.';
  end if;

  -- Serialize publication/visibility changes on the owned source recording.
  select r.id into v_recording_id
  from public.voice_recordings as r
  join public.voice_versions as v on v.recording_id = r.id
  where v.id = p_version_id and r.owner_id = v_owner_id
  for update of r;
  if not found then
    raise exception using errcode = '42501', message = 'The selected voice version is not owned by the authenticated user.';
  end if;

  -- Match the cleanup helper's transaction lock before reading object metadata
  -- or creating a listing reference. The recording lock above is not taken by
  -- cleanup, which only reads listing references after its advisory lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('voice-previews/' || p_preview_path, 0)
  );
  if private.valid_listing_preview(p_version_id, p_preview_path, p_preview_duration_seconds) is distinct from true then
    raise exception using errcode = '22023', message = 'A valid owned private source and separate 5–8 second WAV preview are required.';
  end if;

  update public.voice_recordings set visibility = 'public'
  where id = v_recording_id and visibility <> 'public';

  insert into public.listings (
    version_id, status, sale_price_cents, rental_price_cents,
    rental_days, currency, preview_path, preview_duration_seconds
  ) values (
    p_version_id, 'published', p_sale_price_cents, p_rental_price_cents,
    30, 'EUR', p_preview_path, p_preview_duration_seconds
  ) returning id into v_listing_id;

  return v_listing_id;
end;
$function$;

revoke all on function public.publish_voice_listing(uuid, text, numeric, integer, integer, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_voice_listing(uuid, text, numeric, integer, integer, boolean, boolean)
  to authenticated;

-- Existing licenses continue resolving the same immutable version/private path.
-- Archiving changes only status; no file, listing, or license is removed.
