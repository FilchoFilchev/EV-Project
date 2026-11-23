-- Forward-only correction for the Storage upload permission probe.
-- Storage checks INSERT authorization with provisional MIME metadata before
-- reading the file body. Its finalized system metadata.size is not available
-- at that point. contentLength can include multipart boundaries, so it is not
-- a substitute for file size (especially at the exact eight-second limit).
-- Source: https://github.com/supabase/storage/blob/v1.96.4/src/storage/uploader.ts
--
-- Keep the existing helper signature/ACL and every owner/path/MIME restriction.
-- Finalized metadata, when size is present, still receives the same strict
-- size checks. The WAV-only bucket's 256044-byte cap and publication RPC's
-- mandatory finalized size/duration checks remain unchanged.
create or replace function private.can_upload_voice_preview(p_name text, p_metadata jsonb)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and p_name ~ (
      '^' || (select auth.uid())::text ||
      '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]wav$'
    )
    and pg_catalog.lower(pg_catalog.split_part(coalesce(p_metadata ->> 'mimetype', ''), ';', 1)) = 'audio/wav'
    and case when p_metadata ? 'size' then
      case when p_metadata ->> 'size' ~ '^[0-9]{6}$' then
        (p_metadata ->> 'size')::bigint between 160044 and 256044
        and ((p_metadata ->> 'size')::bigint - 44) % 2 = 0
      else false end
    else true end;
$function$;
