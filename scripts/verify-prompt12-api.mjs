import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DEVELOPMENT_HOST = 'zysyghbbbesatbehravb.supabase.co'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class AttackTestFailure extends Error {}

export function validateAttackConfig(env, args) {
  if (!args.includes('--confirm-echovault-dev')) {
    throw new AttackTestFailure('Pass --confirm-echovault-dev; no network request was made.')
  }
  let url
  try { url = new URL(env.SUPABASE_TEST_URL) } catch {
    throw new AttackTestFailure('SUPABASE_TEST_URL is missing or invalid.')
  }
  if (
    url.protocol !== 'https:' || url.hostname !== DEVELOPMENT_HOST ||
    url.port || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash
  ) {
    throw new AttackTestFailure('Only the exact echovault-dev HTTPS URL is allowed.')
  }
  const key = env.SUPABASE_TEST_PUBLISHABLE_KEY ?? ''
  let publicKey = key.startsWith('sb_publishable_') && key.length > 15
  if (!publicKey) {
    try {
      publicKey = key.split('.').length === 3 &&
        JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'
    } catch { publicKey = false }
  }
  if (!publicKey) throw new AttackTestFailure('A publishable/anon key is required; privileged keys are refused.')
  if (!env.PROMPT12_FREE_EMAIL || !env.PROMPT12_FREE_PASSWORD) {
    throw new AttackTestFailure('Provide dedicated Free demo-account credentials in the local environment.')
  }
  if (!UUID_PATTERN.test(env.PROMPT12_FREE_USER_ID ?? '')) {
    throw new AttackTestFailure('Provide the verified UUID of the existing disposable Free User A.')
  }
  if (!UUID_PATTERN.test(env.PROMPT12_DISPOSABLE_RECORDING_ID ?? '')) {
    throw new AttackTestFailure('Provide the ID of a new owned recording titled "Prompt12 disposable ...".')
  }
  return {
    url: url.origin, key,
    email: env.PROMPT12_FREE_EMAIL,
    password: env.PROMPT12_FREE_PASSWORD,
    expectedUserId: env.PROMPT12_FREE_USER_ID,
    recordingId: env.PROMPT12_DISPOSABLE_RECORDING_ID,
  }
}

export function makeAttackWav() {
  const bytes = Buffer.alloc(16044)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(8000, 24)
  bytes.writeUInt32LE(16000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(16000, 40)
  return new Blob([bytes], { type: 'audio/wav' })
}

export function assertEditedInsertDenied(result) {
  // Constraint, network, malformed input, and missing-object errors do not
  // establish authorization protection. Require PostgreSQL's RLS denial code.
  if (result.error?.code !== '42501' || result.status !== 403 || result.data ||
      !/row-level security policy.*\bvoice_versions\b/i.test(result.error?.message ?? '')) {
    throw new AttackTestFailure(
      `Edited insert was not denied by voice_versions RLS (HTTP ${result.status ?? 'unknown'}, SQLSTATE ${result.error?.code ?? 'none'}). Stop and inspect the disposable fixture; no cleanup was attempted.`
    )
  }
}

async function main() {
  const config = validateAttackConfig(process.env, process.argv.slice(2))
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  try {
    const login = await client.auth.signInWithPassword({ email: config.email, password: config.password })
    if (login.error) throw new AttackTestFailure('Demo sign-in failed; credentials were not printed.')
    const verified = await client.auth.getUser()
    const userId = verified.data?.user?.id
    if (verified.error || !userId) throw new AttackTestFailure('The demo session could not be verified.')
    if (userId !== config.expectedUserId ||
        verified.data.user.email?.toLowerCase() !== config.email.toLowerCase()) {
      throw new AttackTestFailure('The session does not match the configured existing disposable Free User A.')
    }

    const [role, subscription, entitlement, recording, originals, versionsBefore] = await Promise.all([
      client.from('user_roles').select('role').eq('user_id', userId).single(),
      client.from('subscriptions').select('plan').eq('user_id', userId).single(),
      client.rpc('has_active_premium'),
      client.from('voice_recordings').select('id,owner_id,title,visibility').eq('id', config.recordingId).single(),
      client.from('voice_versions').select('id').eq('recording_id', config.recordingId).eq('effect_type', 'original'),
      client.from('voice_versions').select('id,effect_type,storage_path').eq('recording_id', config.recordingId),
    ])
    if ([role, subscription, entitlement, recording, originals, versionsBefore].some((result) => result.error)) {
      throw new AttackTestFailure('Preflight failed. Apply/review the Prompt 12 migration and verify the dedicated fixture first.')
    }
    if (role.data.role !== 'user' || subscription.data.plan !== 'free' || entitlement.data !== false) {
      throw new AttackTestFailure('The attack requires an ordinary Free demo user.')
    }
    if (
      recording.data.owner_id !== userId || recording.data.visibility !== 'private' ||
      !recording.data.title.startsWith('Prompt12 disposable ') || originals.data.length !== 1
    ) {
      throw new AttackTestFailure('Only a new private owned "Prompt12 disposable ..." recording with one original is allowed.')
    }
    console.log(`PASS preflight: echovault-dev, disposable Free User A ${userId}, owned private source ${config.recordingId}`)

    const blob = makeAttackWav()
    const storagePath = `${userId}/${randomUUID()}.wav`
    console.log(`echovault-dev disposable attack upload: ${storagePath}`)
    const upload = await client.storage.from('voice-files').upload(storagePath, blob, {
      contentType: 'audio/wav', upsert: false,
    })
    if (upload.error) throw new AttackTestFailure('Disposable WAV upload failed; edited insertion was not tested.')

    for (const effectType of ['muffle', 'distortion', 'echo']) {
      const result = await client.from('voice_versions').insert({
        recording_id: config.recordingId,
        effect_type: effectType,
        effect_settings: { intensity: 50 },
        storage_path: storagePath,
        duration_seconds: 1,
        mime_type: 'audio/wav',
        file_size_bytes: blob.size,
      }).select('id').single()
      assertEditedInsertDenied(result)
      console.log(`PASS Free direct REST insert denied: ${effectType} (HTTP ${result.status}, SQLSTATE ${result.error.code}) — ${result.error.message}`)
    }
    const after = await client.from('voice_versions').select('id,effect_type,storage_path').eq('recording_id', config.recordingId)
    const signature = (rows) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))
    if (after.error || signature(after.data ?? []) !== signature(versionsBefore.data) ||
        after.data.some((version) => version.storage_path === storagePath)) {
      throw new AttackTestFailure('Post-test verification could not confirm unchanged source versions and an unreferenced attack WAV. Retain all files; no cleanup was attempted.')
    }
    console.log('PASS postflight: source versions unchanged; attack WAV has no version reference.')
    console.log('The new unreferenced attack WAV is retained. No delete, cleanup, original modification, or Marketplace operation ran.')
  } finally {
    await client.auth.signOut({ scope: 'local' })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof AttackTestFailure ? error.message : 'Unexpected API test failure; details withheld to protect credentials.')
    process.exitCode = 1
  })
}
