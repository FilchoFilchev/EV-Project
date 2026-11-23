import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Static authorization-contract checks only: no PostgreSQL execution, network,
// uploads, or remote changes. The companion SQL suite exercises actual INSERT
// RLS when run separately against an isolated local Supabase database.
const applied = await readFile(new URL('../supabase/migrations/20261123120000_listing_public_previews.sql', import.meta.url), 'utf8')
const correction = await readFile(new URL('../supabase/migrations/20261123130000_preview_upload_authorization.sql', import.meta.url), 'utf8')
const sqlTests = await readFile(new URL('../supabase/tests/prompt13_preview_upload_authorization.sql', import.meta.url), 'utf8')
const statements = correction.replace(/^\s*--.*$/gm, '')
const definitions = [...statements.matchAll(/create or replace function\s+([\w.]+)\([\s\S]*?\$function\$;/g)]
assert.equal(definitions.length, 1, 'Correction must replace only the existing INSERT-policy helper')
assert.equal(definitions[0][1], 'private.can_upload_voice_preview')
assert.match(statements, /p_name text, p_metadata jsonb/)
assert.match(statements, /language sql\s+stable\s+security invoker\s+set search_path = ''/)
assert.match(statements, /\(select auth\.uid\(\)\) is not null/)
assert.match(statements, /'\^' \|\| \(select auth\.uid\(\)\)::text \|\|/)
assert.match(statements, /\[\.\]wav\$/)
assert.match(statements, /coalesce\(p_metadata ->> 'mimetype', ''\)/)
assert.match(statements, /= 'audio\/wav'/)
assert.match(statements, /case when p_metadata \? 'size' then\s*case when p_metadata ->> 'size' ~ '\^\[0-9\]\{6\}\$' then/,
  'Explicit size, including null or malformed values, must enter strict finalized validation')
assert.match(statements, /between 160044 and 256044/)
assert.match(statements, /\(\(p_metadata ->> 'size'\)::bigint - 44\) % 2 = 0/)
assert.match(statements, /else false end\s*else true end;/,
  'Only absent finalized size may pass the provisional upload phase')
assert.doesNotMatch(statements, /contentLength/,
  'Multipart request length must never substitute for actual file size')
assert.doesNotMatch(statements, /\b(?:create policy|alter table|insert into|delete from|update |drop |grant |revoke )/i,
  'The fix must not change bucket settings, policy scope, data, or existing grants')

assert.match(applied, /grant execute on function private\.can_upload_voice_preview\(text, jsonb\) to authenticated/)
assert.match(applied, /values \('voice-previews', 'voice-previews', true, 256044, array\['audio\/wav'\]\)/)
assert.match(applied, /preview\.metadata ->> 'size' = \(44 \+ p_duration \* 32000\)::bigint::text/,
  'Publishing must still require finalized size consistent with the declared duration')
assert.match(applied, /p_duration between 5 and 8/)
assert.match(applied, /voice_previews_no_update/)

assert.match(sqlTests, /^begin;/m)
assert.match(sqlTests.trimEnd(), /rollback;$/)
assert.match(sqlTests, /set local role authenticated;/)
assert.match(sqlTests, /set local role anon;/)
assert.match(sqlTests, /insert into storage\.objects/)
assert.match(sqlTests, /returning id into v_id;/)
assert.match(sqlTests, /"contentLength":256411/)
assert.match(sqlTests, /"size":null/)
assert.match(sqlTests, /"size":160044/)
assert.match(sqlTests, /"size":256044/)
assert.doesNotMatch(sqlTests, /^\s*commit\s*;/mi)
console.log('Preview upload policy static checks passed (provisional metadata, finalized boundaries, owner/path/MIME gates and unchanged bucket/publication enforcement; no SQL or network).')
