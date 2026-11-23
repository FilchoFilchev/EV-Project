import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const source = await readFile(new URL('../src/js/config/supabaseClient.js', import.meta.url), 'utf8')
async function setup(env = {}, throws = false) {
  const calls = []
  const context = createContext({ URL })
  const module = new SourceTextModule(source, { context, initializeImportMeta(meta) { meta.env = env } })
  await module.link(() => new SyntheticModule(['createClient'], function () {
    this.setExport('createClient', (...args) => {
      calls.push(args)
      if (throws) throw new Error('Initialization failed')
      return { testClient: true }
    })
  }, { context }))
  await module.evaluate()
  return { ...module.namespace, calls }
}
const valid = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture' }
for (const url of [valid.VITE_SUPABASE_URL, 'http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
  const result = await setup({ ...valid, VITE_SUPABASE_URL: ` ${url} ` })
  assert.equal(result.configurationError, null)
  assert.equal(result.calls[0][0], url)
  assert.equal(result.calls[0][2].auth.persistSession, true)
  assert.equal(result.calls[0][2].auth.autoRefreshToken, true)
}
for (const url of ['', 'not a URL', 'http://example.supabase.co', 'http://localhost.evil.invalid', 'file:///tmp/db',
  'https://username:password@example.supabase.co', 'http://127.0.0.1.evil.invalid', 'ftp://localhost']) {
  const result = await setup({ ...valid, VITE_SUPABASE_URL: url })
  assert.ok(result.configurationError)
  assert.equal(result.supabase, null)
  assert.equal(result.calls.length, 0)
}
for (const key of ['', 'sb_secret_test', 'service_role', 'eyJlegacyJWT', 'contains-secret']) {
  const result = await setup({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key })
  assert.ok(result.configurationError)
  assert.equal(result.calls.length, 0)
}
assert.ok((await setup()).configurationError)
assert.match((await setup(valid, true)).configurationError, /could not be initialized/)
console.log('PASS: local loopback support, HTTPS/credential restrictions, privileged-key rejection and initialization errors. Mocked client; no network.')
