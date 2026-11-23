-- Prompt 15: demo licensing only. No payment processor or external payment
-- confirmation is involved. Existing media, offers, and licenses are preserved.
-- The existing permanent-buy unique index remains the final duplicate guard.
create function public.demo_checkout(p_listing_id uuid, p_license_type text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
-- Keep the fixed rental interval independent of caller/session timezone and DST.
set timezone = 'UTC'
as $function$
declare
  v_buyer_id uuid := (select auth.uid());
  v_recording_id uuid;
  v_seller_id uuid;
  v_visibility text;
  v_listing public.listings%rowtype;
  v_price integer;
  v_license_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if v_buyer_id is null then
    raise exception using errcode = '42501', message = 'Sign in before using Demo Checkout.';
  end if;
  if p_listing_id is null or p_license_type is null
    or p_license_type not in ('buy', 'rent')
  then
    raise exception using errcode = '22023', message = 'Select a listing and a buy or rent license.';
  end if;
  -- Fresh reads after a lock wait are necessary for active-rental retry
  -- safety. PostgREST uses READ COMMITTED; fail closed if trusted SQL invokes
  -- this function in an isolation mode with an older transaction snapshot.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25000', message = 'Demo Checkout requires a READ COMMITTED transaction. Retry in a new transaction.';
  end if;

  -- Follow the immutable version/recording relationship; no seller identity or
  -- price is accepted from the caller. Publication uses this same lock order.
  select v.recording_id into v_recording_id
  from public.listings as l
  join public.voice_versions as v on v.id = l.version_id
  where l.id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable for Demo Checkout.';
  end if;

  -- Lock the source before the listing, preventing a concurrent visibility
  -- change from invalidating the checkout conditions. Separate statements
  -- obtain fresh READ COMMITTED snapshots after any lock wait.
  select r.owner_id, r.visibility into v_seller_id, v_visibility
  from public.voice_recordings as r
  where r.id = v_recording_id
  for update;
  if not found or v_seller_id is null or v_visibility is distinct from 'public' then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable for Demo Checkout.';
  end if;

  select l.* into v_listing
  from public.listings as l
  where l.id = p_listing_id
  for update;
  if not found or v_listing.status is distinct from 'published' then
    raise exception using errcode = 'P0002', message = 'This listing is unavailable for Demo Checkout.';
  end if;
  if v_buyer_id = v_seller_id then
    raise exception using errcode = '42501', message = 'You cannot license your own listing.';
  end if;

  v_price := case p_license_type
    when 'buy' then v_listing.sale_price_cents
    when 'rent' then v_listing.rental_price_cents
  end;
  if v_price is null or v_price <= 0
    or v_listing.currency <> 'EUR' or v_listing.rental_days <> 30
  then
    raise exception using errcode = '22023', message = 'The selected demo license offer is unavailable.';
  end if;

  if exists (
    select 1 from public.licenses as lic
    where lic.listing_id = p_listing_id and lic.buyer_id = v_buyer_id
      and lic.license_type = 'buy'
  ) then
    raise exception using errcode = '23505', message = 'You already have a permanent license for this listing.';
  end if;

  -- There is intentionally no caller-supplied retry key in the required RPC
  -- signature. Repeated rentals while access is active return the original
  -- license, without a second row, price change, or expiry extension. The
  -- listing lock serializes concurrent requests; expired rentals stay history.
  if p_license_type = 'rent' then
    select lic.id into v_license_id
    from public.licenses as lic
    where lic.listing_id = p_listing_id and lic.buyer_id = v_buyer_id
      and lic.license_type = 'rent' and lic.expires_at > v_now
    order by lic.expires_at desc, lic.created_at desc, lic.id
    limit 1;
    if found then return v_license_id; end if;
  end if;

  insert into public.licenses (
    listing_id, buyer_id, license_type, price_cents, created_at, expires_at
  ) values (
    p_listing_id, v_buyer_id, p_license_type, v_price, v_now,
    case when p_license_type = 'rent' then v_now + interval '30 days' else null end
  ) returning id into v_license_id;

  return v_license_id;
end;
$function$;

comment on function public.demo_checkout(uuid, text) is
  'DEMO CHECKOUT: creates a license without charging money. Authenticated buyer and offer price are derived in the database. Active rental retries return the same license without extending it.';

revoke all on function public.demo_checkout(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.demo_checkout(uuid, text) to authenticated;

-- Keep direct client writes unavailable at both privilege and RLS layers.
-- Explicit column revocations also cover older/future column-level grants.
revoke all privileges on table public.licenses from public, anon, authenticated;
revoke insert (id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at),
  update (id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at),
  references (id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at)
  on public.licenses from public, anon, authenticated;
grant select (id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at)
  on public.licenses to authenticated;
-- Existing buyer/admin SELECT policy, immutable licenses, FK RESTRICT behavior,
-- and DB-time access helpers remain in force, including after listing archive.
