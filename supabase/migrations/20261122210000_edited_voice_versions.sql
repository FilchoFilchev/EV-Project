-- Prompt 12: expose the existing DB-time entitlement check without exposing
-- the private schema through PostgREST or accepting a caller-supplied user ID.
create function public.has_active_premium()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select (select auth.uid()) is not null and private.is_premium();
$function$;

revoke all on function public.has_active_premium()
  from public, anon, authenticated, service_role;
grant execute on function public.has_active_premium() to authenticated;

-- Keep the existing owner/Premium INSERT policy and original validation intact.
-- A separate restrictive policy also makes every edited version reference a
-- new uploaded private WAV, with metadata matching the uploaded object.
create policy voice_versions_edited_audio_validation
  on public.voice_versions as restrictive for insert to authenticated
  with check (
    effect_type = 'original'
    or (
      private.is_premium()
      and private.owns_recording(recording_id)
      and mime_type = 'audio/wav'
      and file_size_bytes between 45 and 20971520
      and duration_seconds between 0.001 and 9999999.999
      and pg_catalog.jsonb_typeof(effect_settings) = 'object'
      and case
        when pg_catalog.jsonb_typeof(effect_settings -> 'intensity') = 'number'
        then (effect_settings ->> 'intensity')::numeric between 0 and 100
          and (effect_settings ->> 'intensity')::numeric =
            pg_catalog.trunc((effect_settings ->> 'intensity')::numeric)
        else false
      end
      and storage_path ~ (
        '^' || (select auth.uid())::text ||
        '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]wav$'
      )
      and exists (
        select 1
        from public.voice_versions as original_version
        where original_version.recording_id = voice_versions.recording_id
          and original_version.effect_type = 'original'
      )
      and exists (
        select 1
        from storage.objects as object
        where object.bucket_id = 'voice-files'
          and object.name = storage_path
          and object.metadata ->> 'size' = file_size_bytes::text
          and pg_catalog.lower(pg_catalog.split_part(
            coalesce(object.metadata ->> 'mimetype', ''), ';', 1
          )) = 'audio/wav'
      )
    )
  );

-- The existing unique voice_versions_storage_path_key prevents reusing an
-- original or another version's object. Existing grants prohibit UPDATE and
-- DELETE of versions, and Storage disallows overwriting referenced files.
-- This policy affects future inserts only; it does not rewrite existing data.
