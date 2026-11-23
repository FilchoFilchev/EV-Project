// Source contract checks only. Actual PostgreSQL/RLS and Storage delivery remain
// SKIP until the focused SQL suite and authenticated browser checks are run.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const policies = read('supabase/migrations/20261121183500_rls_policies.sql')
const storage = read('supabase/migrations/20261122180000_private_audio_storage.sql')
const core = read('supabase/migrations/20261121174900_core_schema.sql')
const publication = read('supabase/migrations/20261123120000_listing_public_previews.sql')
const checkout = read('supabase/migrations/20261123140000_demo_checkout.sql')
const tests = read('supabase/tests/prompt16_licensed_audio.sql')
const config = read('supabase/config.toml')
let checks = 0
const matches = (source, pattern, reason) => { assert.match(source, pattern, reason); checks++ }
const absent = (source, pattern, reason) => { assert.doesNotMatch(source, pattern, reason); checks++ }
const helper = (name) => {
  const found = policies.match(new RegExp(`create function private\\.${name}\\([\\s\\S]*?\\$function\\$;`))
  assert.ok(found, `Existing helper ${name}`)
  checks++
  return found[0]
}

const license = helper('has_valid_license_for_version')
matches(license, /security definer\s+set search_path = ''/, 'License helper pins a trusted search_path')
matches(license, /join public\.listings as l on l\.id = lic\.listing_id\s+where l\.version_id = p_version_id/,
  'License resolves the exact version through immutable database relationships')
matches(license, /lic\.buyer_id = \(select auth\.uid\(\)\)/, 'License buyer is the authenticated principal')
matches(license, /lic\.license_type = 'buy' and lic\.expires_at is null/, 'Purchase must be perpetual')
matches(license, /lic\.license_type = 'rent'\s+and lic\.expires_at > pg_catalog\.now\(\)/,
  'Rental uses strict database-time expiry, including equality denial')
absent(license, /l\.status|visibility|is_admin\(/, 'Archived source and role do not change issued entitlement')
const path = helper('can_access_audio_path')
matches(path, /\(select auth\.uid\(\)\) is not null/, 'Path access requires an authenticated identity')
matches(path, /v\.storage_path = p_path/, 'Storage authorization matches exact persisted path')
matches(path, /private\.owns_recording\(v\.recording_id\)\s+or private\.has_valid_license_for_version\(v\.id\)/,
  'Only owner or exact version license authorizes audio')
absent(path, /is_public_version|visibility|is_admin\(/, 'Public metadata and admin role do not expose full audio')
const version = helper('can_read_version')
matches(version, /private\.owns_version\(p_version_id\)\s+or private\.has_valid_license_for_version\(p_version_id\)/,
  'Full version metadata uses the same owner/license boundary')

for (const name of ['has_valid_license_for_version', 'can_access_audio_path', 'can_read_version']) {
  const argument = name === 'can_access_audio_path' ? 'text' : 'uuid'
  matches(policies, new RegExp(`revoke all on function private\\.${name}\\(${argument}\\) from public, anon, authenticated;`),
    `Default execution is revoked for ${name}`)
  matches(policies, new RegExp(`grant execute on function private\\.${name}\\(${argument}\\) to authenticated;`),
    `Authenticated-only execution for ${name}`)
}
matches(policies, /create unique index voice_versions_storage_path_key\s+on public\.voice_versions\(storage_path\)/,
  'Distinct versions cannot share an authorized private object')
absent(policies, /grant update[\s\S]{0,120}on table public\.voice_versions/,
  'Clients cannot redirect immutable version paths')
matches(storage, /'voice-files',\s+'voice-files',\s+false,/, 'Full audio bucket is explicitly private')
matches(storage, /create policy voice_files_select_authorized[\s\S]*?for select to authenticated[\s\S]*?private\.can_access_audio_path\(name\)/,
  'Authenticated Storage SELECT delegates exact licensed path checks')
matches(storage, /create policy voice_files_select_scope[\s\S]*?as restrictive for select to authenticated[\s\S]*?private\.can_access_audio_path\(name\)/,
  'Restrictive policy prevents another permissive SELECT from widening audio access')
matches(storage, /create policy voice_files_select_deny_anon[\s\S]*?as restrictive for select to anon\s+using \(bucket_id <> 'voice-files'\)/,
  'Anonymous private Storage access is explicitly denied')
matches(storage, /create policy voice_files_no_update[\s\S]*?as restrictive for update to anon, authenticated/,
  'Licensed objects cannot be overwritten')
matches(storage, /not exists \([\s\S]*?from public\.voice_versions as v\s+where v\.storage_path = p_path/,
  'Referenced full audio cannot be deleted through cleanup')
matches(publication, /values \('voice-previews', 'voice-previews', true,/, 'Public previews stay in a separate bucket')
matches(publication, /grant update \(status\) on public\.listings to authenticated/,
  'Seller archive grants only a status change')
matches(publication, /create policy listings_owner_archive[\s\S]*?private\.owns_version\(version_id\) and status = 'archived'/,
  'Seller archive does not redirect or remove licensed versions')
matches(core, /version_id uuid not null unique\s+references public\.voice_versions\(id\) on delete restrict/,
  'Listing versions retain deletion protection')
matches(core, /listing_id uuid not null\s+references public\.listings\(id\) on delete restrict/,
  'Issued licenses retain their listing')
matches(checkout, /revoke insert \(id, listing_id, buyer_id, license_type, price_cents, created_at, expires_at\),\s+update/,
  'Client license forging and extension remain prohibited')
matches(config, /^schemas = \["public", "graphql_public"\]$/m, 'Private helpers remain outside exposed API schemas')

for (const scenario of ['security_contract', 'owner_access', 'valid_purchase_and_rental',
  'expired_and_unlicensed_denial', 'seller_archive_preserves_rights', 'missing_identity_denial', 'anonymous_denial']) {
  matches(tests, new RegExp(`do \\$${scenario}\\$`), `Focused SQL scenario: ${scenario}`)
}
matches(tests, /'Same-recording sibling and unrelated version denied for '/, 'SQL tests exact-version isolation')
matches(tests, /array\['expired', 'boundary', 'outsider', 'admin'\]/, 'Admin without license also receives audio denial')
matches(tests, /'Expired buyer can still read their own license receipt'/, 'Receipt history survives rental expiry')
matches(tests, /'Archived expired listing and private version remain hidden'/, 'Expired history does not expose private source')
matches(tests, /when 'boundary' then pg_catalog\.now\(\)/, 'SQL tests expiry at exact DB-time boundary')
matches(tests, /update public\.listings set status = 'archived' where id = v_listing/,
  'SQL archives as authenticated seller')
matches(tests, /^begin;[\s\S]*?^rollback;$/m, 'All disposable fixtures are rolled back')
absent(tests, /^commit;|truncate|delete from|drop table/mi, 'Focused tests contain no cleanup or committed mutation')

const changedMigrations = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations'],
  { cwd: root, encoding: 'utf8' }).trim()
assert.equal(changedMigrations, '', 'Previously applied migrations remain unchanged; existing policies are reused')
checks++
console.log(`PASS: ${checks} Prompt 16 static SQL/security contract checks (source inspection only).`)
console.log('SKIP: PostgreSQL/RLS and Storage HTTP execution require an isolated local Supabase and authenticated browser; no database was contacted.')
