import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source contracts only: these assertions cannot prove live RLS or SQL syntax.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261123150000_reports_and_moderation.sql')
const policies = read('supabase/migrations/20261121183500_rls_policies.sql')
const publication = read('supabase/migrations/20261123120000_listing_public_previews.sql')
const bootstrap = read('supabase/manual/bootstrap_demo_admin.sql')
const tests = read('supabase/tests/prompt17_reports_moderation.sql')
let checks = 0
const matches = (source, regex, reason) => { assert.match(source, regex, reason); checks++ }
const absent = (source, regex, reason) => { assert.doesNotMatch(source, regex, reason); checks++ }
const functions = [...migration.matchAll(/create function public\.(\w+)\([\s\S]*?\$function\$;/g)].map(([source, name]) => ({ source, name }))
assert.equal(functions.length, 7)
checks++
for (const { source, name } of functions) {
  matches(source, /security definer\s+set search_path = ''/, `${name} pins its search path`)
  if (name.startsWith('admin_')) {
    matches(source, /if \(select auth\.uid\(\)\) is null or private\.is_admin\(\) is distinct from true then\s+raise exception using errcode = '42501'/,
      `${name} authorizes the database role before any operation`)
  }
  absent(source, /auth\.jwt|user_metadata|app_metadata|execute\s+format|execute\s+p_/, `${name} does not trust mutable claims or dynamic SQL`)
}
const fn = (name) => functions.find((item) => item.name === name).source
const grants = migration.slice(migration.indexOf('revoke all on function public.create_listing_report'))
matches(grants, /from public, anon, authenticated, service_role;/, 'Default and non-user function execution revoked')
matches(grants, /to authenticated;/, 'Only authenticated callers receive execute; admin functions recheck role')
for (const { name } of functions) {
  assert.equal((grants.match(new RegExp(`public\\.${name}\\(`, 'g')) ?? []).length, 2, `${name} included in revoke and grant`)
  checks++
}
matches(migration, /revoke insert, update, delete on public\.reports from public, anon, authenticated;/, 'Report table writes are revoked')
matches(migration, /revoke insert \(id, listing_id, reporter_id, reason, status, created_at, resolved_at\),\s+update \(id, listing_id, reporter_id, reason, status, created_at, resolved_at\)/, 'Old report column grants are revoked too')
matches(migration, /drop policy reports_insert[\s\S]*?drop policy reports_admin_update/, 'Report writes require checked RPCs')
matches(policies, /using \(reporter_id = \(select auth\.uid\(\)\) or private\.is_admin\(\)\)/, 'Existing own/admin report read RLS is retained')
matches(fn('create_listing_report'), /v_reporter_id uuid := \(select auth\.uid\(\)\)/, 'Reporter identity comes from auth.uid')
matches(fn('create_listing_report'), /pg_catalog\.char_length\(v_reason\) not between 1 and 1000/, 'Server validates report length')
matches(fn('create_listing_report'), /transaction_isolation'\) <> 'read committed'/, 'Duplicate serialization requires fresh statement snapshots')
matches(fn('create_listing_report'), /pg_advisory_xact_lock[\s\S]*?if exists[\s\S]*?r\.listing_id = p_listing_id and r\.reporter_id = v_reporter_id[\s\S]*?errcode = '23505'/, 'Server serializes and rejects same pair duplicates without deleting legacy data')
matches(fn('create_listing_report'), /l\.status = 'published'[\s\S]*?v_visibility = 'public' and l\.preview_path is not null/, 'Only visible published offers can be reported')
matches(fn('create_listing_report'), /insert into public\.reports \(listing_id, reporter_id, reason\)/, 'Initial status and times use database defaults')
matches(fn('admin_resolve_report'), /if v_report\.status = 'resolved' then return v_report\.id/, 'Repeated resolution preserves timestamp')
matches(fn('admin_resolve_report'), /set status = 'resolved', resolved_at = pg_catalog\.now\(\)/, 'Resolution uses database time')
matches(fn('admin_moderate_listing'), /p_status not in \('published', 'archived'\)/, 'No invented moderation state')
matches(fn('admin_moderate_listing'), /v_listing\.status not in \('published', 'archived'\)/, 'Admins cannot publish draft listings')
matches(fn('admin_moderate_listing'), /v_visibility is distinct from 'public' or v_listing\.preview_path is null/, 'Restore validates public source/preview')
matches(fn('admin_moderate_listing'), /update public\.listings set status = p_status where id = p_listing_id/, 'Moderation modifies listing status only')
matches(publication, /private\.owns_version\(version_id\) and status = 'archived'/, 'Owners remain unable to undo moderation by restoring listings')
matches(fn('admin_set_premium'), /p_plan not in \('free', 'premium'\)/, 'Plan validation')
matches(fn('admin_set_premium'), /pg_catalog\.now\(\) \+ interval '30 days' else null end/, 'Premium expires in 30 DB days; Free clears expiry')
for (const name of ['admin_list_users', 'admin_list_listings', 'admin_list_reports']) {
  matches(fn(name), /p_limit not between 1 and 200/, `${name} validates pagination`)
  absent(fn(name), /storage_path|preview_path|email|auth\.users/, `${name} limits returned metadata`)
}
// No storage/licensing/schema ACL changes or role promotion are part of migration.
const uncommented = migration.replace(/--[^\n]*/g, '')
absent(uncommented, /(?:insert into|update|delete from|alter table)\s+(?:storage\.|public\.(?:licenses|voice_versions|voice_recordings|user_roles))/, 'No changes to audio, licenses, roles, or source data')
absent(uncommented, /grant\s+(?:all|insert|update|delete)|drop table|truncate|create\s+(?:or replace\s+)?function private\./, 'No widened writes or replaced licensing helpers')
matches(bootstrap, /v_demo_admin_id uuid := null;/, 'Manual bootstrap is disabled by default')
matches(bootstrap, /if v_demo_admin_id is null then\s+raise exception/, 'Unedited manual bootstrap aborts')
matches(bootstrap, /v_demo_admin_email text := null;/, 'Manual email is disabled by default')
matches(bootstrap, /if v_demo_admin_email is null or pg_catalog\.btrim\(v_demo_admin_email\) = '' then\s+raise exception/, 'Missing email aborts manual bootstrap')
matches(bootstrap, /where u\.id = v_demo_admin_id and u\.email = v_demo_admin_email/, 'Manual identity check matches both verified UUID and email')
matches(bootstrap, /where ur\.user_id = v_demo_admin_id and ur\.role = 'user'\s+and u\.id = ur\.user_id and u\.email = v_demo_admin_email/, 'Only the matching ordinary user can be promoted')
matches(bootstrap, /get diagnostics v_promoted_count = row_count;\s+if v_promoted_count <> 1 then\s+raise exception/, 'Manual bootstrap requires exactly one promotion or rolls back')
absent(bootstrap.replace(/--[^\n]*/g, ''), /(?:insert into|update|delete from)\s+(?:public\.(?:subscriptions|profiles|voice_recordings|voice_versions|licenses|listings|reports)|storage\.)/, 'Manual bootstrap cannot change subscription, content or licenses')
matches(tests, /^begin;/m, 'Database tests use a transaction')
matches(tests, /^rollback;/m, 'Database tests roll back disposable fixtures')
for (const role of ['anon', 'authenticated']) matches(tests, new RegExp(`set local role ${role}`), `${role} tested explicitly`)
matches(tests, /admin_moderate_listing/, 'SQL includes moderation attempts')
matches(tests, /admin_set_premium/, 'SQL includes plan attempts')
matches(tests, /admin_resolve_report/, 'SQL includes report resolution attempts')
matches(tests, /can_access_audio_path/, 'SQL checks audio authorization after moderation')

console.log(`PASS: ${checks} Prompt 17 SQL/security source-contract checks.`)
console.log('SKIP: Actual PostgreSQL/RLS/REST/concurrency execution; no database was contacted.')
