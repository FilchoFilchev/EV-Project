drop policy if exists voice_recordings_select on public.voice_recordings;

create policy voice_recordings_select
  on public.voice_recordings for select to authenticated
  using (
    owner_id = (select auth.uid())
    or private.can_view_recording(id)
  );

drop policy if exists voice_versions_select on public.voice_versions;

create policy voice_versions_select
  on public.voice_versions for select to authenticated
  using (
    private.owns_recording(recording_id)
    or private.can_read_version(id)
  );
