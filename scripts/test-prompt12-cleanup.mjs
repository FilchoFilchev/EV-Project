import assert from 'node:assert/strict'
import {
  ATTACK_PATH, SOURCE_PATH, PROJECT_REF, USER_ID, BUCKET,
  parseCleanupOptions, validateGlobalConfirmation, runCleanup,
} from './cleanup-prompt12-attack-wav.mjs'

const now = Date.now()
const confirmation = {
  project_ref: PROJECT_REF, bucket_id: BUCKET, attack_path: ATTACK_PATH,
  global_scope_verified: true, attack_global_references: 0, checked_at: new Date(now).toISOString(),
}
const preflight = parseCleanupOptions([`--project-ref=${PROJECT_REF}`, '--preflight'])
const execution = parseCleanupOptions([
  `--project-ref=${PROJECT_REF}`, '--execute', `--approve-exact-path=${ATTACK_PATH}`,
  '--sql-editor-confirmation=never-read-by-mocked-tests.local',
])
assert.equal(preflight.execute, false)
assert.equal(execution.execute, true)
assert.throws(() => parseCleanupOptions(['--project-ref=zysyghbbesatbehravb', '--preflight']), /identity/)
assert.throws(() => parseCleanupOptions([`--project-ref=${PROJECT_REF}`, '--execute']), /requires explicit approval/)
assert.throws(() => parseCleanupOptions([
  `--project-ref=${PROJECT_REF}`, '--execute', `--approve-exact-path=${SOURCE_PATH}`, '--sql-editor-confirmation=test.local',
]), /requires explicit approval/)
assert.throws(() => parseCleanupOptions([`--project-ref=${PROJECT_REF}`, '--execute', '--preflight']), /Choose only/)
assert.throws(() => parseCleanupOptions([`--project-ref=${PROJECT_REF}`, '--path=other.wav']), /Unknown/)
assert.equal(validateGlobalConfirmation([confirmation], now).attack_global_references, 0)
for (const change of [
  { project_ref: 'another-project' }, { bucket_id: 'another-bucket' }, { attack_path: SOURCE_PATH },
  { global_scope_verified: false }, { attack_global_references: 1 }, { attack_global_references: '0' },
  { checked_at: new Date(now - 16 * 60 * 1000).toISOString() }, { checked_at: new Date(now + 60_000).toISOString() },
]) assert.throws(() => validateGlobalConfirmation({ ...confirmation, ...change }, now))

function mockClient(changes = {}) {
  const calls = []
  const original = new Blob([new Uint8Array(16044)], { type: 'audio/wav' })
  const sourceRows = changes.sourceRows ?? [{ id: 'original-id', effect_type: 'original' }]
  let removed = false
  const info = (name) => ({ data: { name, bucketId: BUCKET, contentType: 'audio/wav', size: 16044 }, error: null })
  const bucket = {
    info: async (name) => {
      calls.push(['info', name])
      if (name === SOURCE_PATH && changes.sourceInfo) return changes.sourceInfo
      return name === ATTACK_PATH && changes.attackInfo ? changes.attackInfo : info(name)
    },
    download: async (name) => {
      calls.push(['download', name])
      return { data: removed && changes.sourceChanged && name === SOURCE_PATH
        ? new Blob([new Uint8Array(16044).fill(1)], { type: 'audio/wav' }) : original, error: null }
    },
    remove: async (paths) => {
      calls.push(['remove', [...paths]])
      assert.deepEqual(paths, [ATTACK_PATH])
      assert.ok(!paths.includes(SOURCE_PATH))
      removed = true
      if (changes.removeThrows) throw new Error('Lost response')
      return changes.removeResult ?? { data: [{ name: ATTACK_PATH }], error: null }
    },
    exists: async (name) => {
      calls.push(['exists', name])
      if (changes.existsThrows) throw new Error('Invalid JWT')
      return changes.existsResult ?? { data: false, error: { code: 'NoSuchKey', status: 404 } }
    },
  }
  const client = {
    auth: { getUser: async () => {
      calls.push(['getUser'])
      return { data: { user: { id: changes.wrongUser ? 'other-user' : USER_ID } }, error: null }
    } },
    storage: { from: (name) => { assert.equal(name, BUCKET); return bucket } },
    from: (name) => {
      assert.equal(name, 'voice_versions')
      return { select: () => ({ eq: async (column, value) => {
        calls.push(['references', value])
        assert.equal(column, 'storage_path')
        return {
          data: value === ATTACK_PATH ? (changes.references ?? []) : sourceRows,
          error: (value === ATTACK_PATH ? changes.referencesError : changes.sourceReferenceError) ? { code: '42501' } : null,
        }
      } }) }
    },
  }
  return { client, calls }
}

let mock = mockClient()
let result = await runCleanup(mock.client, preflight)
assert.equal(result.mode, 'preflight')
assert.equal(result.removed, false)
assert.equal(mock.calls.some(([action]) => action === 'remove'), false, 'Read-only preflight must never delete')
mock = mockClient()
await assert.rejects(runCleanup(mock.client, execution), /SQL Editor/)
assert.equal(mock.calls.length, 0, 'Missing global confirmation must fail before remote operations')
for (const changes of [
  { wrongUser: true }, { references: [{ id: 'referenced-version' }] },
  { referencesError: true }, { sourceReferenceError: true }, { sourceRows: [] },
  { sourceInfo: { data: null, error: { code: 'NoSuchKey' } } },
  { attackInfo: { data: { name: SOURCE_PATH, bucketId: BUCKET, contentType: 'audio/wav', size: 16044 } } },
  { attackInfo: { data: { name: ATTACK_PATH, bucketId: BUCKET, contentType: 'audio/mpeg', size: 16044 } } },
  { attackInfo: { data: { name: ATTACK_PATH, bucketId: BUCKET, contentType: 'audio/wav', size: 16045 } } },
]) {
  mock = mockClient(changes)
  await assert.rejects(runCleanup(mock.client, execution, confirmation))
  assert.equal(mock.calls.some(([action]) => action === 'remove'), false)
}
mock = mockClient()
result = await runCleanup(mock.client, execution, confirmation)
assert.equal(result.removed, true)
assert.equal(result.absenceVerified, true)
assert.equal(result.sourceBytesAndReferenceUnchanged, true)
assert.equal(mock.calls.filter(([action]) => action === 'remove').length, 1)
for (const changes of [
  { removeThrows: true }, { removeResult: { data: [], error: null } },
  { existsThrows: true }, { existsResult: { data: true, error: null } },
  { existsResult: { data: false, error: { status: 403, code: 'InvalidJWT' } } },
  { existsResult: { data: false, error: null } }, { sourceChanged: true },
]) {
  mock = mockClient(changes)
  await assert.rejects(runCleanup(mock.client, execution, confirmation))
  assert.equal(mock.calls.filter(([action]) => action === 'remove').length, 1, 'Uncertain results must never trigger automatic retry')
}

console.log('PASS Prompt 12 cleanup safety: exact target, approval/global SQL gates, read-only default, MIME/size/references, missing-key verification, original preservation. Mock clients only; no network or real deletion.')
