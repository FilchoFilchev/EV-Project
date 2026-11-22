import assert from 'node:assert/strict'
import { validateAttackConfig, makeAttackWav, assertEditedInsertDenied } from './verify-prompt12-api.mjs'

const env = {
  SUPABASE_TEST_URL: 'https://zysyghbbbesatbehravb.supabase.co',
  SUPABASE_TEST_PUBLISHABLE_KEY: 'sb_publishable_test_placeholder',
  PROMPT12_FREE_EMAIL: 'demo@example.test',
  PROMPT12_FREE_PASSWORD: 'local-test-placeholder',
  PROMPT12_FREE_USER_ID: '00000000-0000-4000-8000-000000000002',
  PROMPT12_DISPOSABLE_RECORDING_ID: '00000000-0000-4000-8000-000000000001',
}
const args = ['--confirm-echovault-dev']
assert.equal(validateAttackConfig(env, args).url, env.SUPABASE_TEST_URL)
assert.throws(() => validateAttackConfig(env, []), /no network/)
for (const url of [
  'https://primary.supabase.co',
  'http://zysyghbbbesatbehravb.supabase.co',
  'https://zysyghbbbesatbehravb.supabase.co.evil.test',
  'https://zysyghbbbesatbehravb.supabase.co/other',
  'https://user:password@zysyghbbbesatbehravb.supabase.co',
]) {
  assert.throws(() => validateAttackConfig({ ...env, SUPABASE_TEST_URL: url }, args), /Only the exact/)
}
assert.throws(() => validateAttackConfig({ ...env, SUPABASE_TEST_PUBLISHABLE_KEY: 'sb_secret_placeholder' }, args), /privileged/)
assert.throws(() => validateAttackConfig({ ...env, PROMPT12_DISPOSABLE_RECORDING_ID: '' }, args), /ID/)
assert.throws(() => validateAttackConfig({ ...env, PROMPT12_FREE_USER_ID: '' }, args), /User A/)
assert.equal(validateAttackConfig(env, args).expectedUserId, env.PROMPT12_FREE_USER_ID)
assertEditedInsertDenied({ status: 403, data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "voice_versions"' } })
for (const result of [
  { status: 403, data: null, error: { code: '42501', message: 'permission denied for table voice_versions' } },
  { status: 403, data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "another_table"' } },
  { data: { id: 'unexpected' }, error: null },
  { data: null, error: { code: '23505' } },
  { data: null, error: { code: '23514' } },
  { data: null, error: null },
]) assert.throws(() => assertEditedInsertDenied(result), /not denied by voice_versions RLS/)
const blob = makeAttackWav()
assert.equal(blob.type, 'audio/wav')
assert.equal(blob.size, 16044)
const wav = Buffer.from(await blob.arrayBuffer())
assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
assert.equal(wav.readUInt32LE(40), 16000)
console.log('PASS Prompt 12 API test safety: development-only target, no privileged keys, strict authorization denial, valid WAV fixture. No network requests made.')
