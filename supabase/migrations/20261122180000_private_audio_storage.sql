insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'voice-files',
  'voice-files',
  false,
  20971520,
  array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg']
)
on conflict (id) do nothing;

do $bucket_check$
begin
  if not exists (
    select 1
    from storage.buckets as b
    where b.id = 'voice-files'
      and b.name = 'voice-files'
      and b.public is false
      and b.file_size_limit = 20971520
      and b.allowed_mime_types = array[
        'audio/wav',
        'audio/x-wav',
        'audio/mpeg',
        'audio/mp4',
        'audio/webm',
        'audio/ogg'
      ]
  ) then
    raise exception
      'The voice-files bucket already exists with incompatible settings; review it manually without changing its privacy or restrictions.';
  end if;
end;
$bucket_check$;

drop policy if exists voice_files_select_authorized on storage.objects;
create policy voice_files_select_authorized
  on storage.objects as permissive for select to authenticated
  using (
    bucket_id = 'voice-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.can_access_audio_path(name)
    )
  );

drop policy if exists voice_files_select_scope on storage.objects;
create policy voice_files_select_scope
  on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'voice-files'
    or (
      bucket_id = 'voice-files'
      and (
        (storage.foldername(name))[1] = (select auth.uid())::text
        or private.can_access_audio_path(name)
      )
    )
  );

drop policy if exists voice_files_select_deny_anon on storage.objects;
create policy voice_files_select_deny_anon
  on storage.objects as restrictive for select to anon
  using (bucket_id <> 'voice-files');

drop policy if exists voice_files_insert_own_folder on storage.objects;
create policy voice_files_insert_own_folder
  on storage.objects as permissive for insert to authenticated
  with check (
    bucket_id = 'voice-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ (
      '^' || (select auth.uid())::text ||
      '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.](wav|mp3|m4a|ogg|webm)$'
    )
    and case pg_catalog.lower(pg_catalog.split_part(coalesce(metadata ->> 'mimetype', ''), ';', 1))
      when 'audio/wav' then name ~ '[.]wav$'
      when 'audio/x-wav' then name ~ '[.]wav$'
      when 'audio/mpeg' then name ~ '[.]mp3$'
      when 'audio/mp4' then name ~ '[.]m4a$'
      when 'audio/webm' then name ~ '[.]webm$'
      when 'audio/ogg' then name ~ '[.]ogg$'
      else false
    end
  );

drop policy if exists voice_files_insert_scope on storage.objects;
create policy voice_files_insert_scope
  on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'voice-files'
    or (
      bucket_id = 'voice-files'
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and name ~ (
        '^' || (select auth.uid())::text ||
        '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.](wav|mp3|m4a|ogg|webm)$'
      )
      and case pg_catalog.lower(pg_catalog.split_part(coalesce(metadata ->> 'mimetype', ''), ';', 1))
        when 'audio/wav' then name ~ '[.]wav$'
        when 'audio/x-wav' then name ~ '[.]wav$'
        when 'audio/mpeg' then name ~ '[.]mp3$'
        when 'audio/mp4' then name ~ '[.]m4a$'
        when 'audio/webm' then name ~ '[.]webm$'
        when 'audio/ogg' then name ~ '[.]ogg$'
        else false
      end
    )
  );

drop policy if exists voice_files_insert_deny_anon on storage.objects;
create policy voice_files_insert_deny_anon
  on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'voice-files');

drop policy if exists voice_files_no_update on storage.objects;
create policy voice_files_no_update
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'voice-files')
  with check (bucket_id <> 'voice-files');

create or replace function private.can_delete_unreferenced_audio(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and pg_catalog.split_part(p_path, '/', 1) = (select auth.uid())::text
    and not exists (
      select 1
      from public.voice_versions as v
      where v.storage_path = p_path
    );
$function$;

revoke all on function private.can_delete_unreferenced_audio(text)
  from public, anon, authenticated;
grant execute on function private.can_delete_unreferenced_audio(text)
  to authenticated;

drop policy if exists voice_files_delete_unreferenced_own on storage.objects;
create policy voice_files_delete_unreferenced_own
  on storage.objects as permissive for delete to authenticated
  using (
    bucket_id = 'voice-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.can_delete_unreferenced_audio(name)
  );

drop policy if exists voice_files_delete_scope on storage.objects;
create policy voice_files_delete_scope
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'voice-files'
    or (
      bucket_id = 'voice-files'
      and (storage.foldername(name))[1] = (select auth.uid())::text
      and private.can_delete_unreferenced_audio(name)
    )
  );

drop policy if exists voice_files_delete_deny_anon on storage.objects;
create policy voice_files_delete_deny_anon
  on storage.objects as restrictive for delete to anon
  using (bucket_id <> 'voice-files');

drop policy if exists voice_versions_original_audio_validation on public.voice_versions;
create policy voice_versions_original_audio_validation
  on public.voice_versions as restrictive for insert to authenticated
  with check (
    effect_type <> 'original'
    or (
      (storage.foldername(storage_path))[1] = (select auth.uid())::text
      and storage_path ~ (
        '^' || (select auth.uid())::text ||
        '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]' ||
        case mime_type
          when 'audio/wav' then 'wav'
          when 'audio/x-wav' then 'wav'
          when 'audio/mpeg' then 'mp3'
          when 'audio/mp4' then 'm4a'
          when 'audio/webm' then 'webm'
          when 'audio/ogg' then 'ogg'
          else 'unsupported'
        end ||
        '$'
      )
      and file_size_bytes between 1 and 20971520
      and duration_seconds between 0.001 and 9999999.999
      and exists (
        select 1
        from storage.objects as o
        where o.bucket_id = 'voice-files'
          and o.name = storage_path
          and o.metadata ->> 'size' = file_size_bytes::text
          and pg_catalog.lower(
            pg_catalog.split_part(coalesce(o.metadata ->> 'mimetype', ''), ';', 1)
          ) = mime_type
      )
    )
  );

create or replace function public.create_original_voice_recording(
  p_title text,
  p_category text,
  p_description text,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_duration_seconds numeric
)
returns table (recording_id uuid, version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_owner_id uuid := (select auth.uid());
  v_title text := pg_catalog.btrim(p_title);
  v_category text := pg_catalog.btrim(p_category);
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_extension text;
  v_metadata jsonb;
  v_recording_id uuid;
  v_version_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if v_title is null or pg_catalog.char_length(v_title) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Invalid recording title.';
  end if;

  if v_category is null or pg_catalog.char_length(v_category) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Invalid recording category.';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes not between 1 and 20971520 then
    raise exception using errcode = '22023', message = 'Invalid audio file size.';
  end if;

  if p_duration_seconds is null
    or p_duration_seconds <= 0
    or p_duration_seconds > 9999999.999
    or p_duration_seconds::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception using errcode = '22023', message = 'Invalid audio duration.';
  end if;

  if p_mime_type is null or p_mime_type not in (
    'audio/wav',
    'audio/x-wav',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/ogg'
  ) then
    raise exception using errcode = '22023', message = 'Unsupported audio MIME type.';
  end if;

  v_extension := case p_mime_type
    when 'audio/wav' then 'wav'
    when 'audio/x-wav' then 'wav'
    when 'audio/mpeg' then 'mp3'
    when 'audio/mp4' then 'm4a'
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    else null
  end;

  if p_storage_path is null
    or p_storage_path !~ (
      '^' || v_owner_id::text ||
      '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]' ||
      v_extension || '$'
    )
  then
    raise exception using errcode = '42501', message = 'Audio path is not owned by the authenticated user.';
  end if;

  select o.metadata
    into v_metadata
  from storage.objects as o
  where o.bucket_id = 'voice-files'
    and o.name = p_storage_path;

  if not found then
    raise exception using errcode = '42501', message = 'Uploaded private audio object was not found.';
  end if;

  if v_metadata ->> 'size' is distinct from p_file_size_bytes::text
    or pg_catalog.lower(pg_catalog.split_part(coalesce(v_metadata ->> 'mimetype', ''), ';', 1)) <> p_mime_type
  then
    raise exception using errcode = '22023', message = 'Uploaded object metadata does not match the request.';
  end if;

  insert into public.voice_recordings (
    owner_id,
    title,
    description,
    category,
    visibility
  )
  values (
    v_owner_id,
    v_title,
    nullif(v_description, ''),
    v_category,
    'private'
  )
  returning id into v_recording_id;

  insert into public.voice_versions (
    recording_id,
    effect_type,
    effect_settings,
    storage_path,
    duration_seconds,
    mime_type,
    file_size_bytes
  )
  values (
    v_recording_id,
    'original',
    '{}'::jsonb,
    p_storage_path,
    p_duration_seconds,
    p_mime_type,
    p_file_size_bytes
  )
  returning id into v_version_id;

  return query select v_recording_id, v_version_id;
end;
$function$;

revoke all on function public.create_original_voice_recording(
  text, text, text, text, text, bigint, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.create_original_voice_recording(
  text, text, text, text, text, bigint, numeric
) to authenticated;
