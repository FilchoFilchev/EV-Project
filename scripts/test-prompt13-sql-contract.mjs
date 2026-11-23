import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Static security-contract checks only. These do not execute PostgreSQL,
// contact Supabase, apply migrations, or prove runtime RLS behavior.
const migration = await readFile(new URL('../supabase/migrations/20261123120000_listing_public_previews.sql', import.meta.url), 'utf8')
const sqlTests = await readFile(new URL('../supabase/tests/prompt13_listings_previews.sql', import.meta.url), 'utf8')

const functions = [...migration.matchAll(/create function\s+([\w.]+)\([\s\S]*?\$function\$;/g)]
assert.equal(functions.length, 4, 'Review every new function security boundary')
for (const [definition, name] of functions) {
  assert.match(definition, /set search_path = ''/, `${name} must pin its search path`)
  assert.ok(migration.includes(`revoke all on function ${name}(`), `${name} must revoke default EXECUTE`)
}

assert.match(migration, /revoke insert, update on table public\.listings from authenticated/)
assert.match(migration, /revoke insert \(version_id, status, sale_price_cents, rental_price_cents,\s*rental_days, currency, preview_path\)/)
assert.match(migration, /revoke update \(status, sale_price_cents, rental_price_cents, rental_days,\s*currency, preview_path\)/)
assert.match(migration, /grant update \(status\) on public\.listings to authenticated/)
assert.match(migration, /with check \(private\.owns_version\(version_id\) and status = 'archived'\)/)
assert.doesNotMatch(migration, /grant execute on function private\.valid_listing_preview/,
  'Publication validation is an internal definer-only helper')

const publication = functions.find(([, name]) => name === 'public.publish_voice_listing')?.[0]
assert.ok(publication)
assert.match(publication, /v_owner_id uuid := \(select auth\.uid\(\)\)/)
assert.match(publication, /p_make_public is distinct from true or p_rights_confirmed is distinct from true/)
assert.match(publication, /r\.owner_id = v_owner_id\s+for update of r/)
assert.match(publication, /private\.valid_listing_preview\(/)
const cleanup = functions.find(([, name]) => name === 'private.can_delete_unreferenced_preview')?.[0]
assert.ok(cleanup)
assert.match(cleanup, /language plpgsql\s+volatile\s+security definer/)
const advisoryKey = /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\('voice-previews\/' \|\| (p_path|p_preview_path), 0\)\s*\)/
assert.match(cleanup, advisoryKey)
assert.match(publication, advisoryKey)
assert.ok(cleanup.indexOf('pg_catalog.pg_advisory_xact_lock(') < cleanup.indexOf('select not exists ('),
  'Cleanup must check references in a separate query after waiting for publication')
assert.ok(publication.indexOf('pg_catalog.pg_advisory_xact_lock(') < publication.indexOf('if private.valid_listing_preview('),
  'Publication must acquire the same preview lock before validating the object')
assert.match(publication, /30, 'EUR', p_preview_path, p_preview_duration_seconds/)
assert.match(migration, /from public, anon, authenticated, service_role;\s*grant execute on function public\.publish_voice_listing/)

assert.doesNotMatch(migration, /\b(?:delete from|truncate|drop table)\s+(?:public|storage)\./i,
  'This migration must preserve existing data')
assert.doesNotMatch(migration, /create or replace function private\.(?:has_valid_license_for_version|can_access_audio_path)/,
  'Archive must preserve existing license access rules')
assert.match(sqlTests, /^begin;/m)
assert.match(sqlTests.trimEnd(), /rollback;$/)
assert.doesNotMatch(sqlTests, /^\s*commit\s*;/mi)
assert.match(sqlTests, /private\.has_valid_license_for_version/)
assert.match(sqlTests, /expired_renter/)
assert.match(sqlTests, /legacy placeholder listing could not be archived/)

console.log('Prompt 13 static SQL security-contract checks passed (no SQL execution or network).')
