create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_roles as ur
    where ur.user_id = (select auth.uid())
      and ur.role = 'admin'
  );
$function$;

create function private.is_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.subscriptions as s
    where s.user_id = (select auth.uid())
      and s.plan = 'premium'
      and s.expires_at > pg_catalog.now()
  );
$function$;

create function private.owns_recording(p_recording_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.voice_recordings as r
    where r.id = p_recording_id
      and r.owner_id = (select auth.uid())
  );
$function$;

create function private.owns_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.voice_versions as v
    join public.voice_recordings as r on r.id = v.recording_id
    where v.id = p_version_id
      and r.owner_id = (select auth.uid())
  );
$function$;

create function private.has_valid_license_for_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.licenses as lic
    join public.listings as l on l.id = lic.listing_id
    where l.version_id = p_version_id
      and lic.buyer_id = (select auth.uid())
      and (
        (lic.license_type = 'buy' and lic.expires_at is null)
        or (
          lic.license_type = 'rent'
          and lic.expires_at > pg_catalog.now()
        )
      )
  );
$function$;

create function private.is_public_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.voice_versions as v
      join public.voice_recordings as r on r.id = v.recording_id
      where v.id = p_version_id
        and r.visibility = 'public'
    );
$function$;

create function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (
      p_profile_id = (select auth.uid())
      or private.is_admin()
      or exists (
        select 1
        from public.listings as l
        join public.voice_versions as v on v.id = l.version_id
        join public.voice_recordings as r on r.id = v.recording_id
        where r.owner_id = p_profile_id
          and r.visibility = 'public'
          and l.status = 'published'
          and l.preview_path is not null
      )
    );
$function$;

create function private.can_view_recording(p_recording_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.voice_recordings as r
      where r.id = p_recording_id
        and (
          r.owner_id = (select auth.uid())
          or r.visibility = 'public'
          or private.is_admin()
          or exists (
            select 1
            from public.voice_versions as v
            join public.listings as l on l.version_id = v.id
            join public.licenses as lic on lic.listing_id = l.id
            where v.recording_id = r.id
              and lic.buyer_id = (select auth.uid())
              and (
                (lic.license_type = 'buy' and lic.expires_at is null)
                or (
                  lic.license_type = 'rent'
                  and lic.expires_at > pg_catalog.now()
                )
              )
          )
        )
    );
$function$;

create function private.can_read_version(p_version_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (
      private.owns_version(p_version_id)
      or private.has_valid_license_for_version(p_version_id)
    );
$function$;

create function private.can_access_audio_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.voice_versions as v
      where v.storage_path = p_path
        and (
          private.owns_recording(v.recording_id)
          or private.has_valid_license_for_version(v.id)
        )
    );
$function$;

revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.is_premium() from public, anon, authenticated;
revoke all on function private.owns_recording(uuid) from public, anon, authenticated;
revoke all on function private.owns_version(uuid) from public, anon, authenticated;
revoke all on function private.has_valid_license_for_version(uuid) from public, anon, authenticated;
revoke all on function private.is_public_version(uuid) from public, anon, authenticated;
revoke all on function private.can_view_profile(uuid) from public, anon, authenticated;
revoke all on function private.can_view_recording(uuid) from public, anon, authenticated;
revoke all on function private.can_read_version(uuid) from public, anon, authenticated;
revoke all on function private.can_access_audio_path(text) from public, anon, authenticated;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_premium() to authenticated;
grant execute on function private.owns_recording(uuid) to authenticated;
grant execute on function private.owns_version(uuid) to authenticated;
grant execute on function private.has_valid_license_for_version(uuid) to authenticated;
grant execute on function private.is_public_version(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_view_recording(uuid) to authenticated;
grant execute on function private.can_read_version(uuid) to authenticated;
grant execute on function private.can_access_audio_path(text) to authenticated;

create unique index voice_versions_storage_path_key
  on public.voice_versions(storage_path);

revoke all privileges on table
  public.profiles,
  public.user_roles,
  public.subscriptions,
  public.voice_recordings,
  public.voice_versions,
  public.listings,
  public.licenses,
  public.reports
from public, anon, authenticated;

grant select (id, display_name)
  on table public.profiles to authenticated;
grant update (display_name)
  on table public.profiles to authenticated;

grant select (user_id, role) on table public.user_roles to authenticated;

grant select (user_id, plan, expires_at, updated_at)
  on table public.subscriptions to authenticated;

grant select (id, owner_id, title, description, category, visibility, created_at, updated_at)
  on table public.voice_recordings to authenticated;
grant insert (owner_id, title, description, category, visibility)
  on table public.voice_recordings to authenticated;
grant update (title, description, category, visibility)
  on table public.voice_recordings to authenticated;

grant select (id, recording_id, effect_type, effect_settings, storage_path,
              duration_seconds, mime_type, file_size_bytes, created_at)
  on table public.voice_versions to authenticated;
grant insert (recording_id, effect_type, effect_settings, storage_path,
              duration_seconds, mime_type, file_size_bytes)
  on table public.voice_versions to authenticated;

grant select (id, version_id, status, sale_price_cents, rental_price_cents,
              rental_days, currency, preview_path, created_at)
  on table public.listings to authenticated;
grant insert (version_id, status, sale_price_cents, rental_price_cents,
              rental_days, currency, preview_path)
  on table public.listings to authenticated;
grant update (status, sale_price_cents, rental_price_cents, rental_days,
              currency, preview_path)
  on table public.listings to authenticated;

grant select (id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at)
  on table public.licenses to authenticated;

grant select (id, listing_id, reporter_id, reason, status, created_at, resolved_at)
  on table public.reports to authenticated;
grant insert (listing_id, reporter_id, reason)
  on table public.reports to authenticated;
grant update (status, resolved_at) on table public.reports to authenticated;

create policy profiles_select
  on public.profiles for select to authenticated
  using (private.can_view_profile(id));

create policy profiles_update
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy user_roles_select
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

create policy subscriptions_select
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

create policy voice_recordings_select
  on public.voice_recordings for select to authenticated
  using (private.can_view_recording(id));

create policy voice_recordings_insert
  on public.voice_recordings for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy voice_recordings_update
  on public.voice_recordings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy voice_versions_select
  on public.voice_versions for select to authenticated
  using (private.can_read_version(id));

create policy voice_versions_insert
  on public.voice_versions for insert to authenticated
  with check (
    private.owns_recording(recording_id)
    and (effect_type = 'original' or private.is_premium())
    and pg_catalog.split_part(storage_path, '/', 1) = (select auth.uid())::text
  );

create policy listings_select
  on public.listings for select to authenticated
  using (
    private.is_admin()
    or private.owns_version(version_id)
    or (status = 'published' and private.is_public_version(version_id))
    or private.has_valid_license_for_version(version_id)
  );

create policy listings_insert
  on public.listings for insert to authenticated
  with check (
    private.owns_version(version_id)
    and (
      preview_path is null
      or pg_catalog.split_part(preview_path, '/', 1) = (select auth.uid())::text
    )
    and (
      status <> 'published'
      or (preview_path is not null and private.is_public_version(version_id))
    )
  );

create policy listings_update
  on public.listings for update to authenticated
  using (private.owns_version(version_id))
  with check (
    private.owns_version(version_id)
    and (
      preview_path is null
      or pg_catalog.split_part(preview_path, '/', 1) = (select auth.uid())::text
    )
    and (
      status <> 'published'
      or (preview_path is not null and private.is_public_version(version_id))
    )
  );

create policy licenses_select
  on public.licenses for select to authenticated
  using (buyer_id = (select auth.uid()) or private.is_admin());

create policy reports_select
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_admin());

create policy reports_insert
  on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and resolved_at is null
  );

create policy reports_admin_update
  on public.reports for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create view public.marketplace_listing_summaries
  with (security_barrier = true, security_invoker = false)
as
  select
    l.id as listing_id,
    v.id as version_id,
    r.id as recording_id,
    r.title,
    r.description,
    r.category,
    r.owner_id as seller_id,
    p.display_name as seller_display_name,
    v.effect_type,
    v.duration_seconds,
    v.mime_type,
    l.sale_price_cents,
    l.rental_price_cents,
    l.rental_days,
    l.currency,
    l.preview_path,
    l.created_at
  from public.listings as l
  join public.voice_versions as v on v.id = l.version_id
  join public.voice_recordings as r on r.id = v.recording_id
  join public.profiles as p on p.id = r.owner_id
  where l.status = 'published'
    and r.visibility = 'public'
    and l.preview_path is not null;

comment on view public.marketplace_listing_summaries is
  'Authenticated-only, owner-executed marketplace projection. Exposes published public listing metadata only; never exposes private voice storage paths.';

revoke all privileges on table public.marketplace_listing_summaries
  from public, anon, authenticated;
grant select on table public.marketplace_listing_summaries to authenticated;
