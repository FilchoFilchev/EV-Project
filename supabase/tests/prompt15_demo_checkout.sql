-- Prompt 15 focused SQL regression. Run only on an isolated LOCAL database
-- after applying all nine migrations, using a trusted owner connection:
--   psql <LOCAL database URL> -v ON_ERROR_STOP=1 -f supabase/tests/prompt15_demo_checkout.sql
-- No actual media is uploaded. Fresh disposable fixtures and the failure
-- trigger below are transaction-local and are always rolled back.
-- Concurrency requires separate sessions; see docs/prompt15-validation.md.
begin;

do $trusted_role$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Prompt 15 fixtures require a trusted isolated local SQL role.';
  end if;
end;
$trusted_role$;

create temporary table prompt15_users (
  principal text primary key,
  user_id uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
insert into prompt15_users (principal)
values ('seller'), ('buyer'), ('renter'), ('outsider'), ('expired_renter');

create temporary table prompt15_offers (
  offer text primary key,
  recording_id uuid not null default pg_catalog.gen_random_uuid(),
  version_id uuid not null default pg_catalog.gen_random_uuid(),
  listing_id uuid not null default pg_catalog.gen_random_uuid()
) on commit drop;
insert into prompt15_offers (offer)
values ('both'), ('sale_only'), ('rent_only'), ('draft'), ('archived'), ('private'), ('failure');
grant select on pg_temp.prompt15_users, pg_temp.prompt15_offers to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
select user_id, 'prompt15-' || user_id::text || '@example.test',
  '{"display_name":"Prompt15 disposable SQL user"}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from prompt15_users;

insert into public.voice_recordings (id, owner_id, title, category, visibility)
select recording_id, u.user_id, 'Prompt15 disposable ' || offer, 'test',
  case when offer = 'private' then 'private' else 'public' end
from prompt15_offers cross join prompt15_users as u where u.principal = 'seller';
insert into public.voice_versions (
  id, recording_id, effect_type, storage_path, duration_seconds, mime_type, file_size_bytes
)
select version_id, recording_id, 'original',
  u.user_id::text || '/' || version_id::text || '.wav', 12, 'audio/wav', 384044
from prompt15_offers cross join prompt15_users as u where u.principal = 'seller';
insert into storage.objects (bucket_id, name, metadata)
select 'voice-files', u.user_id::text || '/' || version_id::text || '.wav',
  '{"size":384044,"mimetype":"audio/wav"}'::jsonb
from prompt15_offers cross join prompt15_users as u where u.principal = 'seller';
insert into public.listings (
  id, version_id, status, sale_price_cents, rental_price_cents,
  rental_days, currency, preview_path, preview_duration_seconds
)
select listing_id, version_id,
  case when offer in ('draft', 'archived') then offer else 'published' end,
  case when offer = 'rent_only' then null else 1234 end,
  case when offer = 'sale_only' then null else 250 end,
  30, 'EUR', u.user_id::text || '/' || listing_id::text || '.wav', 6
from prompt15_offers cross join prompt15_users as u where u.principal = 'seller';

insert into public.licenses (listing_id, buyer_id, license_type, price_cents, created_at, expires_at)
select o.listing_id, u.user_id, 'rent', 199, pg_catalog.now() - interval '31 days',
  pg_catalog.now() - interval '1 day'
from prompt15_users as u cross join prompt15_offers as o
where u.principal = 'expired_renter' and o.offer = 'both';

create function pg_temp.prompt15_assert(p_condition boolean, p_message text)
returns void language plpgsql as $function$
begin
  if p_condition is distinct from true then raise exception 'FAIL: %', p_message; end if;
end;
$function$;

create function pg_temp.prompt15_identity(p_principal text)
returns void language plpgsql as $function$
declare v_user_id uuid;
begin
  select user_id into strict v_user_id from pg_temp.prompt15_users where principal = p_principal;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);
end;
$function$;

create function pg_temp.prompt15_checkout_error(p_listing_id uuid, p_type text, p_code text)
returns void language plpgsql as $function$
declare v_code text;
begin
  begin
    perform public.demo_checkout(p_listing_id, p_type);
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  perform pg_temp.prompt15_assert(v_code = p_code,
    'Expected checkout SQLSTATE ' || p_code || ', received ' || coalesce(v_code, 'success'));
end;
$function$;

-- Observe the actual checkout execution context, then fail AFTER INSERT when
-- requested to prove the RPC leaves no partially created license.
create function pg_temp.prompt15_force_failure()
returns trigger language plpgsql as $function$
begin
  perform pg_temp.prompt15_assert(pg_catalog.current_setting('TimeZone') = 'UTC',
    'Checkout executes with UTC even when caller timezone differs');
  if pg_catalog.current_setting('prompt15.fail_insert', true) = 'on' then
    raise exception using errcode = 'P0015', message = 'Prompt15 forced transaction failure';
  end if;
  return new;
end;
$function$;
create trigger prompt15_force_failure after insert on public.licenses
for each row execute function pg_temp.prompt15_force_failure();

do $security_contract$
declare v_proc record;
begin
  select p.prosecdef, p.provolatile, p.proconfig, p.proargnames into strict v_proc
  from pg_catalog.pg_proc as p where p.oid = 'public.demo_checkout(uuid,text)'::regprocedure;
  perform pg_temp.prompt15_assert(v_proc.prosecdef and v_proc.provolatile = 'v', 'Trusted volatile RPC');
  perform pg_temp.prompt15_assert(v_proc.proconfig @> array['search_path=""'], 'Pinned empty search_path');
  perform pg_temp.prompt15_assert(exists (
    select 1 from pg_catalog.unnest(v_proc.proconfig) as entry(setting)
    where pg_catalog.lower(entry.setting) = 'timezone=utc'
  ), 'Pinned UTC timezone independent of caller preference');
  perform pg_temp.prompt15_assert(v_proc.proargnames = array['p_listing_id', 'p_license_type'],
    'RPC accepts only listing and license type');
  perform pg_temp.prompt15_assert(pg_catalog.has_function_privilege('authenticated',
    'public.demo_checkout(uuid,text)', 'EXECUTE'), 'Authenticated EXECUTE');
  perform pg_temp.prompt15_assert(not pg_catalog.has_function_privilege('anon',
    'public.demo_checkout(uuid,text)', 'EXECUTE'), 'Anonymous EXECUTE denied');
  perform pg_temp.prompt15_assert(not pg_catalog.has_function_privilege('service_role',
    'public.demo_checkout(uuid,text)', 'EXECUTE'), 'No explicit service-role checkout endpoint');
  perform pg_temp.prompt15_assert((select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.licenses'::regclass), 'Licenses RLS remains enabled');
  perform pg_temp.prompt15_assert(not pg_catalog.has_any_column_privilege('authenticated',
    'public.licenses', 'INSERT,UPDATE,REFERENCES')
    and not pg_catalog.has_table_privilege('authenticated', 'public.licenses', 'DELETE,TRUNCATE'),
    'Authenticated direct license mutations denied');
  perform pg_temp.prompt15_assert(not pg_catalog.has_any_column_privilege('anon',
    'public.licenses', 'SELECT,INSERT,UPDATE,REFERENCES')
    and not pg_catalog.has_table_privilege('anon', 'public.licenses', 'DELETE,TRUNCATE'),
    'Anonymous license access denied');
end;
$security_contract$;

set local role authenticated;
do $authorization_and_invalid_offers$
declare v_id uuid; v_before bigint;
begin
  select listing_id into v_id from pg_temp.prompt15_offers where offer = 'both';
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', '42501');
  perform pg_temp.prompt15_identity('seller');
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', '42501');
  perform pg_temp.prompt15_checkout_error(v_id, 'rent', '42501');
  perform pg_temp.prompt15_identity('buyer');
  select count(*) into v_before from public.licenses;
  perform pg_temp.prompt15_checkout_error(null, 'buy', '22023');
  perform pg_temp.prompt15_checkout_error(v_id, null, '22023');
  perform pg_temp.prompt15_checkout_error(v_id, 'BUY', '22023');
  perform pg_temp.prompt15_checkout_error(v_id, 'premium', '22023');
  perform pg_temp.prompt15_checkout_error(pg_catalog.gen_random_uuid(), 'buy', 'P0002');
  for v_id in select listing_id from pg_temp.prompt15_offers
    where offer in ('draft', 'archived', 'private') loop
    perform pg_temp.prompt15_checkout_error(v_id, 'buy', 'P0002');
    perform pg_temp.prompt15_checkout_error(v_id, 'rent', 'P0002');
  end loop;
  select listing_id into v_id from pg_temp.prompt15_offers where offer = 'sale_only';
  perform pg_temp.prompt15_checkout_error(v_id, 'rent', '22023');
  select listing_id into v_id from pg_temp.prompt15_offers where offer = 'rent_only';
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', '22023');
  perform pg_temp.prompt15_assert((select count(*) from public.licenses) = v_before,
    'Rejected operations created no licenses');
end;
$authorization_and_invalid_offers$;

do $purchase_and_abuse$
declare v_id uuid; v_license_id uuid; v_before bigint; v_code text;
begin
  perform pg_temp.prompt15_identity('buyer');
  select listing_id into v_id from pg_temp.prompt15_offers where offer = 'both';
  v_license_id := public.demo_checkout(v_id, 'buy');
  perform pg_catalog.set_config('prompt15.buy_id', v_license_id::text, true);
  perform pg_temp.prompt15_assert(exists (
    select 1 from public.licenses where id = v_license_id and listing_id = v_id
      and buyer_id = auth.uid() and license_type = 'buy' and price_cents = 1234
      and created_at = pg_catalog.now() and expires_at is null
  ), 'Purchase records authenticated buyer, exact DB cents, DB timestamp, perpetual expiry');
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', '23505');
  perform pg_temp.prompt15_checkout_error(v_id, 'rent', '23505');
  perform pg_temp.prompt15_assert((select count(*) from public.licenses where listing_id = v_id) = 1,
    'Repeated buy and redundant rental do not create rows');

  -- Forged client prices/identities/expiry cannot select an overload.
  begin
    execute 'select public.demo_checkout($1, $2, p_price_cents => 1)'
      using v_id, 'buy';
    raise exception 'FAIL: accepted forged price argument';
  exception when undefined_function then null; end;
  begin
    execute 'select public.demo_checkout($1, $2, p_buyer_id => $3, p_seller_id => $3, p_expires_at => null)'
      using v_id, 'buy', auth.uid();
    raise exception 'FAIL: accepted forged identity or expiry arguments';
  exception when undefined_function then null; end;
  begin
    insert into public.licenses (listing_id, buyer_id, license_type, price_cents)
    values (v_id, auth.uid(), 'buy', 1);
    raise exception 'FAIL: direct license INSERT permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.licenses set price_cents = 1 where id = v_license_id;
    raise exception 'FAIL: direct price UPDATE permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.licenses set buyer_id = pg_catalog.gen_random_uuid() where id = v_license_id;
    raise exception 'FAIL: buyer reassignment permitted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.licenses where id = v_license_id;
    raise exception 'FAIL: license DELETE permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.listings set sale_price_cents = 1 where id = v_id;
    raise exception 'FAIL: caller changed trusted sale price';
  exception when insufficient_privilege then null; end;

  select count(*) into v_before from public.licenses;
  perform pg_catalog.set_config('prompt15.fail_insert', 'on', true);
  select listing_id into v_id from pg_temp.prompt15_offers where offer = 'failure';
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', 'P0015');
  perform pg_temp.prompt15_checkout_error(v_id, 'rent', 'P0015');
  perform pg_catalog.set_config('prompt15.fail_insert', 'off', true);
  perform pg_temp.prompt15_assert((select count(*) from public.licenses) = v_before,
    'AFTER INSERT failures rolled back all license writes');
  v_license_id := public.demo_checkout(v_id, 'buy');
  perform pg_temp.prompt15_assert(exists (select 1 from public.licenses where id = v_license_id),
    'Safe retry succeeds after rolled-back transaction failure');

  perform pg_temp.prompt15_identity('outsider');
  perform pg_temp.prompt15_assert(not exists (select 1 from public.licenses
    where id = pg_catalog.current_setting('prompt15.buy_id')::uuid), 'Other buyers cannot read license');
end;
$purchase_and_abuse$;

do $rentals$
declare
  v_id uuid; v_license_id uuid; v_retry_id uuid; v_expiry timestamptz; v_old_id uuid; v_version uuid;
  v_caller_timezone text := pg_catalog.current_setting('TimeZone');
begin
  select listing_id, version_id into v_id, v_version from pg_temp.prompt15_offers where offer = 'both';
  perform pg_temp.prompt15_identity('renter');
  -- A PostgREST timezone preference must not affect the fixed 30-day term.
  perform pg_catalog.set_config('TimeZone', 'America/New_York', true);
  v_license_id := public.demo_checkout(v_id, 'rent');
  perform pg_temp.prompt15_assert(pg_catalog.current_setting('TimeZone') = 'America/New_York',
    'Function-local UTC setting restores caller timezone after checkout');
  perform pg_catalog.set_config('TimeZone', v_caller_timezone, true);
  perform pg_catalog.set_config('prompt15.rent_id', v_license_id::text, true);
  select expires_at into v_expiry from public.licenses where id = v_license_id;
  perform pg_temp.prompt15_assert(exists (
    select 1 from public.licenses where id = v_license_id and listing_id = v_id
      and buyer_id = auth.uid() and license_type = 'rent' and price_cents = 250
      and created_at = pg_catalog.now()
      and extract(epoch from (expires_at - created_at)) = 2592000
  ), 'Rental records DB price and exactly 2592000 seconds of DB-time expiry');
  v_retry_id := public.demo_checkout(v_id, 'rent');
  perform pg_temp.prompt15_assert(v_retry_id = v_license_id
    and (select expires_at from public.licenses where id = v_license_id) = v_expiry
    and (select count(*) from public.licenses where listing_id = v_id) = 1,
    'Repeated rental returns same id without expiry extension or duplicate row');
  begin
    update public.licenses set expires_at = pg_catalog.now() + interval '100 years' where id = v_license_id;
    raise exception 'FAIL: caller extended rental expiry';
  exception when insufficient_privilege then null; end;

  perform pg_temp.prompt15_identity('expired_renter');
  select id into strict v_old_id from public.licenses where listing_id = v_id;
  perform pg_temp.prompt15_assert(not private.has_valid_license_for_version(v_version),
    'Expired rental has no DB-time entitlement');
  v_license_id := public.demo_checkout(v_id, 'rent');
  perform pg_temp.prompt15_assert(v_license_id <> v_old_id
    and (select count(*) from public.licenses where listing_id = v_id) = 2
    and exists (select 1 from public.licenses where id = v_old_id and price_cents = 199
      and expires_at = pg_catalog.now() - interval '1 day')
    and private.has_valid_license_for_version(v_version),
    'Re-rent after expiry issues fresh license and preserves expired history');
end;
$rentals$;

reset role;
-- The seller's future price changes do not rewrite snapshots, including an
-- active rental reused after a price change. Trusted fixture mutation only.
update public.listings set sale_price_cents = 9999, rental_price_cents = 999
where id = (select listing_id from prompt15_offers where offer = 'both');
set local role authenticated;
do $snapshot_and_archive$
declare v_id uuid; v_version uuid; v_license_id uuid;
begin
  select listing_id, version_id into v_id, v_version from pg_temp.prompt15_offers where offer = 'both';
  perform pg_temp.prompt15_identity('renter');
  v_license_id := public.demo_checkout(v_id, 'rent');
  perform pg_temp.prompt15_assert(v_license_id = pg_catalog.current_setting('prompt15.rent_id')::uuid
    and exists (select 1 from public.licenses where id = v_license_id and price_cents = 250),
    'Active rental retry preserves original price after offer change');
  perform pg_temp.prompt15_identity('outsider');
  v_license_id := public.demo_checkout(v_id, 'buy');
  perform pg_temp.prompt15_assert(exists (select 1 from public.licenses where id = v_license_id
    and price_cents = 9999), 'New purchase uses current database price');
  perform pg_temp.prompt15_identity('seller');
  update public.listings set status = 'archived' where id = v_id;
  perform pg_temp.prompt15_assert(exists (select 1 from public.listings where id = v_id
    and status = 'archived'), 'Owner can archive licensed listing');
  perform pg_temp.prompt15_identity('buyer');
  perform pg_temp.prompt15_assert(exists (select 1 from public.licenses
    where id = pg_catalog.current_setting('prompt15.buy_id')::uuid and price_cents = 1234)
    and private.has_valid_license_for_version(v_version), 'Archive preserves permanent license and original price');
  perform pg_temp.prompt15_identity('renter');
  perform pg_temp.prompt15_assert(private.has_valid_license_for_version(v_version)
    and exists (select 1 from public.licenses where id = pg_catalog.current_setting('prompt15.rent_id')::uuid),
    'Archive preserves active rental history and existing entitlement');
  perform pg_temp.prompt15_checkout_error(v_id, 'rent', 'P0002');
  perform pg_temp.prompt15_identity('outsider');
  perform pg_temp.prompt15_checkout_error(v_id, 'buy', 'P0002');
end;
$snapshot_and_archive$;
reset role;

set local role anon;
do $anonymous_direct_abuse$
begin
  begin
    perform public.demo_checkout(pg_catalog.gen_random_uuid(), 'buy');
    raise exception 'FAIL: anonymous RPC execution permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform id from public.licenses limit 1;
    raise exception 'FAIL: anonymous license SELECT permitted';
  exception when insufficient_privilege then null; end;
end;
$anonymous_direct_abuse$;
reset role;

select 'PASS: Prompt 15 SQL assertions; disposable fixtures and forced-failure trigger roll back.' as result;
rollback;

-- An explicit older snapshot must fail safely instead of issuing duplicate
-- active rentals after another transaction commits during the lock wait.
begin isolation level repeatable read;
set local role authenticated;
do $unsupported_isolation$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', pg_catalog.gen_random_uuid()::text, true);
  perform pg_catalog.set_config('request.jwt.claims', '{}', true);
  begin
    perform public.demo_checkout(pg_catalog.gen_random_uuid(), 'rent');
    raise exception 'FAIL: unsupported isolation did not fail closed';
  exception when sqlstate '25000' then null; end;
end;
$unsupported_isolation$;
reset role;
select 'PASS: checkout fails closed for unsupported transaction isolation.' as result;
rollback;
