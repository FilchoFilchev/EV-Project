// Static security contract only. This does not execute PostgreSQL, RLS, locks,
// transactions, or the SQL regression suite; those runtime results stay SKIP.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migrationName = 'supabase/migrations/20261123140000_demo_checkout.sql'
const sql = read(migrationName)
const tests = read('supabase/tests/prompt15_demo_checkout.sql')
const core = read('supabase/migrations/20261121174900_core_schema.sql')
const policies = read('supabase/migrations/20261121183500_rls_policies.sql')
let checks = 0
const matches = (source, pattern, reason) => { assert.match(source, pattern, reason); checks++ }
const absent = (source, pattern, reason) => { assert.doesNotMatch(source, pattern, reason); checks++ }

matches(sql, /create function public\.demo_checkout\(p_listing_id uuid, p_license_type text\)\s+returns uuid/i,
  'Required RPC accepts exactly listing and license type and returns uuid')
matches(sql, /language plpgsql\s+volatile\s+security definer\s+set search_path = ''/i,
  'Privileged RPC pins empty search_path and uses fresh volatile queries')
matches(sql, /^set timezone = 'UTC'$/mi,
  'Rental arithmetic pins UTC rather than accepting caller/session timezone')
matches(sql, /v_buyer_id uuid := \(select auth\.uid\(\)\)/, 'Buyer comes from verified JWT')
matches(sql, /if v_buyer_id is null then\s+raise exception using errcode = '42501'/,
  'Definer explicitly rejects missing identity')
matches(sql, /p_listing_id is null or p_license_type is null[\s\S]*?p_license_type not in \('buy', 'rent'\)/,
  'Null and invalid arguments are rejected')
matches(sql, /current_setting\('transaction_isolation'\) <> 'read committed'[\s\S]*?errcode = '25000'/,
  'Unsupported stale-snapshot transactions fail closed')
absent(sql, /\bset\s+(?:(?:local|session)\s+)?transaction\b|\bset\s+(?:(?:local|session)\s+)?(?:default_)?transaction_isolation\b|set_config\(\s*'(?:default_)?transaction_isolation'/i,
  'RPC checks isolation without attempting an ineffective isolation change')
matches(sql, /join public\.voice_versions as v on v\.id = l\.version_id/,
  'Seller resolution follows trusted version relationship')
matches(sql, /select r\.owner_id, r\.visibility into v_seller_id, v_visibility[\s\S]*?for update;[\s\S]*?select l\.\* into v_listing[\s\S]*?for update;/,
  'Source lock precedes listing lock, serializing visibility, archive, and checkout')
matches(sql, /if not found or v_seller_id is null or v_visibility is distinct from 'public'/,
  'Missing or nonpublic source fails closed')
matches(sql, /v_listing\.status is distinct from 'published'/, 'Only published listings are eligible')
matches(sql, /if v_buyer_id = v_seller_id then[\s\S]*?errcode = '42501'/, 'Self licensing denied')
matches(sql, /when 'buy' then v_listing\.sale_price_cents\s+when 'rent' then v_listing\.rental_price_cents/,
  'Price selected from the matching trusted offer')
matches(sql, /if v_price is null or v_price <= 0[\s\S]*?v_listing\.currency <> 'EUR'[\s\S]*?v_listing\.rental_days <> 30/,
  'Unavailable and inconsistent offer rejected')
matches(sql, /lic\.listing_id = p_listing_id and lic\.buyer_id = v_buyer_id\s+and lic\.license_type = 'buy'[\s\S]*?errcode = '23505'/,
  'Existing permanent buy rejects repeated purchase or redundant rent')
matches(sql, /lic\.license_type = 'rent' and lic\.expires_at > v_now[\s\S]*?if found then return v_license_id; end if;/,
  'Active rental retry returns existing id without extending it')
matches(sql, /v_now timestamptz := pg_catalog\.now\(\)/, 'Trusted database transaction time')
matches(sql, /insert into public\.licenses \(\s+listing_id, buyer_id, license_type, price_cents, created_at, expires_at\s+\) values \(\s+p_listing_id, v_buyer_id, p_license_type, v_price, v_now,\s+case when p_license_type = 'rent' then v_now \+ interval '30 days' else null end/,
  'Atomic insert persists trusted identity, price, timestamp, and expiry')
absent(sql, /p_(?:price|price_cents|buyer_id|seller_id|expires_at|expiry|rental_days)\b/,
  'No caller-controlled price, identity, or expiry')
absent(sql, /exception\s+when|commit\s*;|rollback\s*;/i, 'No swallowed failures or partial transaction commits')
matches(sql, /revoke all on function public\.demo_checkout\(uuid, text\)\s+from public, anon, authenticated, service_role;\s+grant execute on function public\.demo_checkout\(uuid, text\) to authenticated;/i,
  'Only authenticated gets explicit RPC execute grant')
matches(sql, /revoke all privileges on table public\.licenses from public, anon, authenticated;/i,
  'Direct client table write privileges revoked')
matches(sql, /revoke insert \(id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at\),\s+update \(id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at\)/i,
  'Column-level mutation grants also revoked')
absent(sql, /(?:^|\n)\s*(?:update|delete\s+from|truncate|drop\s+table)\s+(?:public|storage)\./i,
  'Migration does not rewrite or remove existing data')
matches(core, /create unique index licenses_one_permanent_buy_per_listing[\s\S]*?where license_type = 'buy'/,
  'Existing unique index remains the permanent purchase backstop')
matches(core, /listing_id uuid not null\s+references public\.listings\(id\) on delete restrict/,
  'Historical licenses retain FK deletion protection')
matches(policies, /create policy licenses_select[\s\S]*?using \(buyer_id = \(select auth\.uid\(\)\) or private\.is_admin\(\)\)/,
  'Existing license SELECT remains scoped to buyer/admin')

for (const scenario of [
  'purchase_and_abuse', 'rentals', 'snapshot_and_archive', 'authorization_and_invalid_offers',
  'anonymous_direct_abuse', 'security_contract', 'unsupported_isolation',
]) matches(tests, new RegExp(`do \\$${scenario}\\$`), `SQL suite includes ${scenario}`)
matches(tests, /create trigger prompt15_force_failure after insert on public\.licenses/,
  'SQL suite forces post-insert failure to test rollback')
matches(tests, /p_price_cents => 1/, 'SQL suite attempts forged price argument')
matches(tests, /p_buyer_id => \$3, p_seller_id => \$3, p_expires_at => null/,
  'SQL suite attempts forged identities and expiry')
matches(tests, /'Expired rental has no DB-time entitlement'/, 'SQL suite checks expired rental')
matches(tests, /'Archive preserves permanent license and original price'/, 'SQL suite checks archival retention')
matches(tests, /pg_catalog\.lower\(entry\.setting\) = 'timezone=utc'/,
  'SQL suite checks timezone proconfig without depending on GUC name case')
matches(tests, /pg_catalog\.set_config\('TimeZone', 'America\/New_York', true\)/,
  'SQL suite invokes real rental with a caller-selected non-UTC timezone')
matches(tests, /current_setting\('TimeZone'\) = 'UTC',\s*'Checkout executes with UTC even when caller timezone differs'/,
  'SQL trigger observes UTC during the actual rental insert')
matches(tests, /'Function-local UTC setting restores caller timezone after checkout'/,
  'SQL suite checks caller timezone restoration after the RPC')
matches(tests, /extract\(epoch from \(expires_at - created_at\)\) = 2592000/,
  'SQL suite checks exactly thirty 24-hour days independently of session timezone')
matches(tests, /begin;[\s\S]*?rollback;[\s\S]*?begin isolation level repeatable read;[\s\S]*?rollback;/,
  'SQL fixtures and isolation scenario are explicitly rolled back')

const changedMigrations = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations'],
  { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
assert.deepEqual(changedMigrations.filter((path) => path !== migrationName), [],
  'Already-applied migrations must remain unchanged')
checks++

console.log(`PASS: ${checks} Prompt 15 static SQL/security contract checks (source inspection only).`)
console.log('SKIP: PostgreSQL/RLS/transaction/concurrency execution requires an isolated local Supabase database; no database was contacted.')
