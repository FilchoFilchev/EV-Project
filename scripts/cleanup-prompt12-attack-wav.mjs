import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { validateAttackConfig } from './verify-prompt12-api.mjs'

export const PROJECT_REF = 'zysyghbbbesatbehravb'
export const USER_ID = '207f9dbf-ae7e-42eb-9925-9fb371724e97'
export const BUCKET = 'voice-files'
export const ATTACK_PATH = `${USER_ID}/4b33d735-ee6b-4acf-9b97-303920117a24.wav`
export const SOURCE_PATH = `${USER_ID}/63e376e8-8bb1-431e-a962-d6fb6a9d80a4.wav`
const EXPECTED_SIZE = 16044
const CONFIRMATION_MAX_AGE_MS = 15 * 60 * 1000

export class CleanupFailure extends Error {}

export function parseCleanupOptions(args) {
  const allowed = new Set(['preflight', 'execute', 'project-ref', 'approve-exact-path', 'sql-editor-confirmation'])
  const parsed = new Map()
  for (const argument of args) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(argument)
    if (!match || !allowed.has(match[1]) || parsed.has(match[1])) throw new CleanupFailure('Unknown or duplicate cleanup option.')
    parsed.set(match[1], match[2] ?? true)
  }
  if (parsed.get('project-ref') !== PROJECT_REF) throw new CleanupFailure(`Project identity must explicitly match verified echovault-dev: ${PROJECT_REF}.`)
  if ((parsed.has('execute') && parsed.get('execute') !== true) ||
      (parsed.has('preflight') && parsed.get('preflight') !== true) ||
      (parsed.has('execute') && parsed.has('preflight'))) throw new CleanupFailure('Choose only --preflight or --execute.')
  const execute = parsed.has('execute')
  if (execute && (parsed.get('approve-exact-path') !== ATTACK_PATH ||
      typeof parsed.get('sql-editor-confirmation') !== 'string')) {
    throw new CleanupFailure('Execution requires explicit approval of the exact attack path and a separate SQL Editor confirmation file.')
  }
  if (!execute && (parsed.has('approve-exact-path') || parsed.has('sql-editor-confirmation'))) {
    throw new CleanupFailure('Approval flags are accepted only with --execute; preflight never deletes.')
  }
  return { execute, confirmationFile: parsed.get('sql-editor-confirmation'), approvedPath: parsed.get('approve-exact-path') }
}

export function validateGlobalConfirmation(input, now = Date.now()) {
  const row = Array.isArray(input) && input.length === 1 ? input[0] : input
  if (!row || row.project_ref !== PROJECT_REF || row.bucket_id !== BUCKET ||
      row.attack_path !== ATTACK_PATH || row.global_scope_verified !== true ||
      row.attack_global_references !== 0) {
    throw new CleanupFailure('SQL Editor confirmation must show trusted global scope and exactly zero references for this project/bucket/path.')
  }
  const checkedAt = typeof row.checked_at === 'string' ? Date.parse(row.checked_at) : NaN
  if (!Number.isFinite(checkedAt) || checkedAt > now + 30_000 || now - checkedAt > CONFIRMATION_MAX_AGE_MS) {
    throw new CleanupFailure('Rerun the SQL Editor check; confirmation must be no more than 15 minutes old.')
  }
  return row
}

function assertObjectInfo(result, expectedPath, expectedSize) {
  const info = result.data
  if (result.error || info?.bucketId !== BUCKET || info.name !== expectedPath ||
      info.contentType !== 'audio/wav' || !Number.isSafeInteger(info.size) || info.size <= 0 ||
      (expectedSize !== undefined && info.size !== expectedSize)) {
    throw new CleanupFailure(`Exact object metadata could not be verified: ${expectedPath}. No further deletion will be attempted.`)
  }
  return info
}

async function readHash(result, expectedSize) {
  if (result.error || !result.data || result.data.type !== 'audio/wav' || result.data.size !== expectedSize) {
    throw new CleanupFailure('Authenticated WAV download did not match the verified MIME and size.')
  }
  return createHash('sha256').update(Buffer.from(await result.data.arrayBuffer())).digest('hex')
}

export async function runCleanup(client, options, globalConfirmation = null) {
  if (options.execute) {
    if (options.approvedPath !== ATTACK_PATH) throw new CleanupFailure('Exact attack-path approval is missing.')
    validateGlobalConfirmation(globalConfirmation)
  }
  const auth = await client.auth.getUser()
  if (auth.error || auth.data?.user?.id !== USER_ID) throw new CleanupFailure('Authenticated UUID does not match disposable User A.')
  const bucket = client.storage.from(BUCKET)
  const [attackInfo, sourceInfo, visibleReferences, sourceReferences] = await Promise.all([
    bucket.info(ATTACK_PATH),
    bucket.info(SOURCE_PATH),
    client.from('voice_versions').select('id').eq('storage_path', ATTACK_PATH),
    client.from('voice_versions').select('id,effect_type').eq('storage_path', SOURCE_PATH),
  ])
  assertObjectInfo(attackInfo, ATTACK_PATH, EXPECTED_SIZE)
  const sourceMetadata = assertObjectInfo(sourceInfo, SOURCE_PATH)
  if (visibleReferences.error || !Array.isArray(visibleReferences.data) || visibleReferences.data.length !== 0) {
    throw new CleanupFailure('Attack path has a visible version reference, or its reference check failed.')
  }
  if (sourceReferences.error || sourceReferences.data?.length !== 1 || sourceReferences.data[0].effect_type !== 'original') {
    throw new CleanupFailure('The referenced source original could not be verified; preserve all files.')
  }
  const [attackDownload, sourceDownload] = await Promise.all([bucket.download(ATTACK_PATH), bucket.download(SOURCE_PATH)])
  await readHash(attackDownload, EXPECTED_SIZE)
  const sourceHash = await readHash(sourceDownload, sourceMetadata.size)
  const summary = {
    result: 'PASS', projectRef: PROJECT_REF, userId: USER_ID, bucket: BUCKET,
    attackPath: ATTACK_PATH, mimeType: 'audio/wav', sizeBytes: EXPECTED_SIZE,
    visibleVersionReferences: 0, preservedSourcePath: SOURCE_PATH,
  }
  if (!options.execute) return { ...summary, mode: 'preflight', removed: false, globalSqlEditorConfirmation: 'REQUIRED BEFORE EXECUTION' }

  // Recheck the human SQL Editor confirmation immediately before the sole delete.
  validateGlobalConfirmation(globalConfirmation)
  let removal
  try {
    removal = await bucket.remove([ATTACK_PATH])
  } catch {
    throw new CleanupFailure('Deletion response was lost. Outcome is uncertain; do not retry deletion automatically.')
  }
  if (removal.error || removal.data?.length !== 1 || removal.data[0].name !== ATTACK_PATH) {
    throw new CleanupFailure('Storage did not confirm removal of exactly the attack WAV. Outcome is uncertain; do not retry automatically.')
  }

  // exists() throws on auth, missing-bucket, and network failures. Only a missing
  // key is evidence of absence; arbitrary failures never mean successful removal.
  const absence = await bucket.exists(ATTACK_PATH)
  const missingKey = absence.error?.code === 'NoSuchKey' ||
    (Number(absence.error?.status) === 404 && absence.error?.code === undefined)
  if (absence.data !== false || !missingKey) throw new CleanupFailure('Removal response succeeded, but exact object absence is unconfirmed. Do not retry deletion.')
  const [sourceAfter, sourceDownloadAfter, sourceReferencesAfter] = await Promise.all([
    bucket.info(SOURCE_PATH), bucket.download(SOURCE_PATH),
    client.from('voice_versions').select('id,effect_type').eq('storage_path', SOURCE_PATH),
  ])
  assertObjectInfo(sourceAfter, SOURCE_PATH, sourceMetadata.size)
  if (await readHash(sourceDownloadAfter, sourceMetadata.size) !== sourceHash || sourceReferencesAfter.error ||
      JSON.stringify(sourceReferencesAfter.data) !== JSON.stringify(sourceReferences.data)) {
    throw new CleanupFailure('Attack removal was confirmed, but preservation verification failed. Stop and inspect; do not delete anything else.')
  }
  return { ...summary, mode: 'execute', removed: true, absenceVerified: true, sourceBytesAndReferenceUnchanged: true }
}

async function main() {
  const options = parseCleanupOptions(process.argv.slice(2))
  let confirmation = null
  if (options.execute) {
    confirmation = validateGlobalConfirmation(JSON.parse(await readFile(options.confirmationFile, 'utf8')))
  }
  const config = validateAttackConfig(process.env, ['--confirm-echovault-dev'])
  if (config.expectedUserId !== USER_ID || config.url !== `https://${PROJECT_REF}.supabase.co`) {
    throw new CleanupFailure('Ignored test configuration does not match the pinned project and User A.')
  }
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  try {
    const login = await client.auth.signInWithPassword({ email: config.email, password: config.password })
    if (login.error) throw new CleanupFailure('Disposable User A sign-in failed; credentials were not printed.')
    const verified = await client.auth.getUser()
    if (verified.error || verified.data?.user?.id !== USER_ID ||
        verified.data.user.email?.toLowerCase() !== config.email.toLowerCase()) throw new CleanupFailure('Disposable User A identity mismatch.')
    console.log(JSON.stringify(await runCleanup(client, options, confirmation), null, 2))
  } finally {
    await client.auth.signOut({ scope: 'local' })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof CleanupFailure ? error.message : 'Cleanup failed; removal is not confirmed. Stop and inspect before any further action.')
    process.exitCode = 1
  })
}
