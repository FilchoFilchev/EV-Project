-- Prompt 17. Forward-only: do not rewrite existing listings, reports, licenses,
-- subscriptions, or Storage objects. No account is promoted to administrator.
-- Reports retain the documented open/resolved states and timestamp history.

-- All report writes go through checked RPCs. Revoke old column ACLs as well as
-- table ACLs; table-level REVOKE alone does not remove a column-level grant.
revoke insert, update, delete on public.reports from public, anon, authenticated;
revoke insert (id, listing_id, reporter_id, reason, status, created_at, resolved_at),
  update (id, listing_id, reporter_id, reason, status, created_at, resolved_at)
  on public.reports from public, anon, authenticated;
drop policy reports_insert on public.reports;
drop policy reports_admin_update on public.reports;

-- Non-unique intentionally: legacy duplicates, if any, are preserved. The RPC
-- serializes each reporter/listing pair before checking all existing reports.
create index reports_listing_reporter_idx on public.reports(listing_id, reporter_id);

create function public.create_listing_report(p_listing_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_reporter_id uuid := (select auth.uid());
  v_reason text;
  v_report_id uuid;
  v_recording_id uuid;
  v_visibility text;
begin
  if v_reporter_id is null then
    raise exception using errcode = '42501', message = 'Sign in before reporting a listing.';
  end if;
  -- Match browser String.trim(), including Unicode spaces and BOM. PostgreSQL
  -- text already rejects NUL; reject other control characters except TAB/LF/CR.
  v_reason := pg_catalog.btrim(p_reason,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_listing_id is null or v_reason is null
    or pg_catalog.char_length(v_reason) not between 1 and 1000
    or v_reason ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F]'
  then
    raise exception using errcode = '22023', message = 'Choose a listing and enter a report reason of 1–1000 characters without control characters.';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'Reporting requires a READ COMMITTED transaction. Retry in a new transaction.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('listing-report/' || p_listing_id::text || '/' || v_reporter_id::text, 0)
  );
  if exists (select 1 from public.reports as r
    where r.listing_id = p_listing_id and r.reporter_id = v_reporter_id)
  then
    raise exception using errcode = '23505', message = 'You have already reported this listing.';
  end if;
  -- A report is about a currently visible Marketplace offer. No owner, reporter,
  -- timestamp, or initial workflow status is accepted from the browser.
  select v.recording_id into v_recording_id from public.listings as l
  join public.voice_versions as v on v.id = l.version_id
  where l.id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable for reporting.';
  end if;
  -- Match checkout/moderation lock order and recheck after waiting.
  select r.visibility into v_visibility from public.voice_recordings as r
  where r.id = v_recording_id for share;
  perform l.id from public.listings as l
  where l.id = p_listing_id and l.status = 'published'
    and v_visibility = 'public' and l.preview_path is not null for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable for reporting.';
  end if;
  insert into public.reports (listing_id, reporter_id, reason)
  values (p_listing_id, v_reporter_id, v_reason)
  returning id into v_report_id;
  return v_report_id;
end;
$function$;

create function public.admin_resolve_report(p_report_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare v_report public.reports%rowtype;
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_report_id is null then
    raise exception using errcode = '22023', message = 'Choose a report to resolve.';
  end if;
  select r.* into v_report from public.reports as r where r.id = p_report_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This report is unavailable.';
  end if;
  -- Retry-safe: never rewrite the first resolution timestamp or report details.
  if v_report.status = 'resolved' then return v_report.id; end if;
  if v_report.status <> 'open' then
    raise exception using errcode = '22023', message = 'Only an open report can be resolved.';
  end if;
  update public.reports set status = 'resolved', resolved_at = pg_catalog.now()
  where id = p_report_id;
  return p_report_id;
end;
$function$;

create function public.admin_moderate_listing(p_listing_id uuid, p_status text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_recording_id uuid;
  v_visibility text;
  v_listing public.listings%rowtype;
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_listing_id is null or p_status is null or p_status not in ('published', 'archived') then
    raise exception using errcode = '22023', message = 'Choose archive or restore for a listing.';
  end if;
  select v.recording_id into v_recording_id
  from public.listings as l join public.voice_versions as v on v.id = l.version_id
  where l.id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable.';
  end if;
  -- Follow checkout/publication lock order: recording first, then listing.
  select r.visibility into v_visibility from public.voice_recordings as r
  where r.id = v_recording_id for update;
  select l.* into v_listing from public.listings as l where l.id = p_listing_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable.';
  end if;
  if v_listing.status not in ('published', 'archived') then
    raise exception using errcode = '22023', message = 'Only published or archived listings can be moderated.';
  end if;
  if p_status = 'published' and (v_visibility is distinct from 'public' or v_listing.preview_path is null) then
    raise exception using errcode = '22023', message = 'Restoring requires a public source and a separate preview.';
  end if;
  if v_listing.status = p_status then return p_listing_id; end if;
  -- Status only. Never change the immutable version, preview, price, license,
  -- source visibility, subscription, or any object in either Storage bucket.
  update public.listings set status = p_status where id = p_listing_id;
  return p_listing_id;
end;
$function$;

create function public.admin_set_premium(p_target_user uuid, p_plan text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_target_user is null or p_plan is null or p_plan not in ('free', 'premium') then
    raise exception using errcode = '22023', message = 'Choose a user and a free or demo Premium plan.';
  end if;
  update public.subscriptions
  set plan = p_plan,
    expires_at = case when p_plan = 'premium' then pg_catalog.now() + interval '30 days' else null end,
    updated_at = pg_catalog.now()
  where user_id = p_target_user;
  if not found then
    raise exception using errcode = 'P0002', message = 'This user subscription is unavailable.';
  end if;
  return p_target_user;
end;
$function$;

create function public.admin_list_users(p_offset integer default 0, p_limit integer default 100)
returns table (id uuid, display_name text, created_at timestamptz, plan text, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Invalid page range.';
  end if;
  return query select p.id, p.display_name, p.created_at, s.plan, s.expires_at
  from public.profiles as p join public.subscriptions as s on s.user_id = p.id
  order by p.created_at desc, p.id limit p_limit offset p_offset;
end;
$function$;

create function public.admin_list_listings(p_offset integer default 0, p_limit integer default 100)
returns table (id uuid, status text, title text, owner_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Invalid page range.';
  end if;
  return query select l.id, l.status, r.title::text, r.owner_id, l.created_at
  from public.listings as l join public.voice_versions as v on v.id = l.version_id
  join public.voice_recordings as r on r.id = v.recording_id
  order by l.created_at desc, l.id limit p_limit offset p_offset;
end;
$function$;

create function public.admin_list_reports(p_offset integer default 0, p_limit integer default 100)
returns table (id uuid, listing_id uuid, reporter_id uuid, reason text, status text,
  created_at timestamptz, resolved_at timestamptz, listing_title text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or private.is_admin() is distinct from true then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Invalid page range.';
  end if;
  return query select rep.id, rep.listing_id, rep.reporter_id, rep.reason, rep.status,
    rep.created_at, rep.resolved_at, r.title::text
  from public.reports as rep join public.listings as l on l.id = rep.listing_id
  join public.voice_versions as v on v.id = l.version_id
  join public.voice_recordings as r on r.id = v.recording_id
  order by rep.created_at desc, rep.id limit p_limit offset p_offset;
end;
$function$;

revoke all on function public.create_listing_report(uuid, text),
  public.admin_resolve_report(uuid), public.admin_moderate_listing(uuid, text),
  public.admin_set_premium(uuid, text), public.admin_list_users(integer, integer),
  public.admin_list_listings(integer, integer), public.admin_list_reports(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_listing_report(uuid, text),
  public.admin_resolve_report(uuid), public.admin_moderate_listing(uuid, text),
  public.admin_set_premium(uuid, text), public.admin_list_users(integer, integer),
  public.admin_list_listings(integer, integer), public.admin_list_reports(integer, integer)
  to authenticated;

-- Existing private.is_admin() reads user_roles from the DB, ignoring JWT user
-- metadata. Existing role/subscription write restrictions remain unchanged.
-- Existing reporter/admin SELECT RLS stays in force. Admin RPC results never
-- expose email addresses, Auth metadata, or private voice-files storage paths.
-- Only trusted manual SQL may bootstrap an admin; no bootstrap is run here.
