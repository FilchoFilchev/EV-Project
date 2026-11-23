import { configurationError, supabase } from '../config/supabaseClient.js'
import { renderPublicPreview } from './audioEngine.js'
import { downloadOriginalAudio } from './storageService.js'
import { MAX_AUDIO_FILE_SIZE_BYTES } from '../utils/audioUploadValidation.js'
import { isUuid, validateListingOptions, validatePublicPreview } from '../utils/listingValidation.js'
import { formatStorageUploadDiagnostics } from '../utils/storageErrorDiagnostics.js'

const PREVIEW_BUCKET = 'voice-previews'
const OWNED_VERSION_FIELDS = 'id,recording_id,effect_type,storage_path,duration_seconds,mime_type,file_size_bytes,recording:voice_recordings!inner(id,owner_id,title,category,visibility)'
const LISTING_FIELDS = 'id,version_id,status,sale_price_cents,rental_price_cents,rental_days,currency,preview_path,preview_duration_seconds,created_at,version:voice_versions!inner(id,effect_type,recording:voice_recordings!inner(id,owner_id,title,category,visibility))'

function failure(message, code = 'listing_error', outcomeUnknown = false) {
  return { message, code, outcomeUnknown }
}

function previewUploadFailure(error, preview, thrown = false) {
  const { diagnostics, summary } = formatStorageUploadDiagnostics(error)
  const setupRequired = diagnostics.storageCode === 'NoSuchBucket' || /bucket.*(not found|does not exist)/i.test(diagnostics.message)
  const outcomeUnknown = diagnostics.httpStatus === null || diagnostics.httpStatus >= 500
  const message = setupRequired
    ? 'Publishing requires the voice-previews bucket in echovault-dev.'
    : thrown || outcomeUnknown
      ? 'The preview upload could not be confirmed. An unused preview may remain.'
      : 'The public preview could not be uploaded. Your private source has not changed.'
  return {
    ...failure(`${message} ${summary}. Preview: ${preview.blob.size} bytes, ${preview.durationSeconds} seconds, mono 16000 Hz PCM16 WAV (audio/wav). No listing was submitted.`,
      setupRequired ? 'setup_required' : outcomeUnknown ? 'upload_outcome_unknown' : 'upload_failed', outcomeUnknown),
    stage: 'storage_upload',
    diagnostics,
    previewDetails: {
      bucket: PREVIEW_BUCKET,
      fileSizeBytes: preview.blob.size,
      durationSeconds: preview.durationSeconds,
      sampleRate: 16000,
      channels: 1,
      mimeType: 'audio/wav',
    },
  }
}

function mapError(error, operation = 'load') {
  const status = Number(error?.status ?? error?.statusCode)
  if (error?.code === '42501' || status === 401 || status === 403) return failure('You are not authorized to publish or manage this voice version.', 'access_denied')
  if (error?.code === '23505') return failure('This version already has a listing. Check My listings before trying again.', 'duplicate_listing')
  if (['PGRST202', 'PGRST204', '42703', '42883'].includes(error?.code)) return failure('Publishing requires the Prompt 13 database migration. Ask the project owner to apply it to echovault-dev.', 'setup_required')
  if (['22023', '23514'].includes(error?.code)) return failure('The recording, preview, or prices do not meet the publication requirements.', 'invalid_listing')
  const definitive = /^[0-9A-Z]{5}$/.test(error?.code ?? '') || (Number.isInteger(status) && status >= 400 && status < 500)
  return failure(operation === 'publish'
    ? 'The publish result could not be confirmed. Refresh My listings before trying again.'
    : 'Your listings could not be loaded or updated. Check your connection and try again.', error?.code || 'network_error', operation === 'publish' && !definitive)
}

async function authenticatedUser() {
  if (!supabase) return { user: null, error: failure(configurationError, 'configuration') }
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !isUuid(data?.user?.id)) return { user: null, error: failure('Sign in before publishing or managing listings.', 'authentication_required') }
    return { user: data.user, error: null }
  } catch {
    return { user: null, error: failure('Your sign-in could not be verified. Please try again.', 'authentication_error') }
  }
}

async function ownedVersion(versionId, userId) {
  if (!isUuid(versionId)) return { version: null, error: failure('Choose a saved voice version.', 'invalid_version') }
  try {
    const { data, error } = await supabase.from('voice_versions').select(OWNED_VERSION_FIELDS)
      .eq('id', versionId).eq('recording.owner_id', userId).maybeSingle()
    if (error) return { version: null, error: mapError(error) }
    if (!data || data.recording?.owner_id !== userId || data.recording_id !== data.recording?.id ||
        !data.storage_path?.startsWith(`${userId}/`)) {
      return { version: null, error: failure('Only your own saved voice versions can be published.', 'access_denied') }
    }
    if (!Number.isSafeInteger(Number(data.file_size_bytes)) || Number(data.file_size_bytes) <= 0 || Number(data.file_size_bytes) > MAX_AUDIO_FILE_SIZE_BYTES) {
      return { version: null, error: failure('The saved audio must be non-empty and 20 MiB or smaller.', 'invalid_audio') }
    }
    return { version: data, error: null }
  } catch {
    return { version: null, error: failure('The saved version could not be verified. Please try again.', 'verification_failed') }
  }
}

async function listingForVersion(versionId) {
  try {
    const { data, error } = await supabase.from('listings').select('id,version_id,status,preview_path')
      .eq('version_id', versionId).maybeSingle()
    return { listing: data ?? null, error: error ? mapError(error) : null }
  } catch {
    return { listing: null, error: failure('The existing listing could not be verified. Refresh My listings.', 'verification_failed', true) }
  }
}

export async function prepareListingPreview({ versionId, startSeconds, durationSeconds }) {
  const { user, error } = await authenticatedUser()
  if (error) return { preview: null, error }
  const result = await ownedVersion(versionId, user.id)
  if (result.error) return { preview: null, error: result.error }
  const existing = await listingForVersion(versionId)
  if (existing.error) return { preview: null, error: existing.error }
  if (existing.listing) return { preview: null, error: failure('This version already has a listing, including archived listings. Choose another version.', 'duplicate_listing') }
  try {
    const audio = await downloadOriginalAudio(result.version.storage_path)
    if (audio.error || !audio.blob) return { preview: null, error: audio.error ?? failure('The private source audio could not be downloaded.') }
    const rendered = await renderPublicPreview(audio.blob, { startSeconds, durationSeconds })
    const previewError = await validatePublicPreview(rendered.blob, rendered.durationSeconds)
    if (previewError) return { preview: null, error: failure(previewError, 'invalid_preview') }
    return { preview: { ...rendered, versionId, recordingId: result.version.recording_id, title: result.version.recording.title }, error: null }
  } catch (renderError) {
    return { preview: null, error: failure(renderError?.message || 'The preview could not be generated.', 'preview_failed') }
  }
}

async function reconcilePublication(versionId, path, originalError) {
  const verification = await listingForVersion(versionId)
  if (verification.listing?.version_id === versionId && verification.listing.preview_path === path) return { listing: verification.listing, error: null }
  if (originalError.outcomeUnknown || verification.error || verification.listing) {
    return { listing: null, error: failure(`${originalError.message} The preview was retained safely. Refresh My listings before retrying.`, originalError.code, originalError.outcomeUnknown || Boolean(verification.error)) }
  }
  // Only a fresh upload with a definitive rejected transaction and verified absence is eligible.
  // Storage RLS independently refuses deletion of every referenced preview, including archived listings.
  try {
    const { data, error } = await supabase.storage.from(PREVIEW_BUCKET).remove([path])
    const removed = !error && Array.isArray(data) && data.some((object) => object?.name === path)
    return { listing: null, error: removed ? originalError : failure(`${originalError.message} An unused preview may remain in Storage.`, originalError.code) }
  } catch {
    return { listing: null, error: failure(`${originalError.message} An unused preview may remain in Storage.`, originalError.code) }
  }
}

export async function publishVoiceListing({ preview, salePrice, rentalPrice, rightsConfirmed, publicConfirmed }) {
  const options = validateListingOptions({ salePrice, rentalPrice, rightsConfirmed, publicConfirmed })
  if (options.error) return { listing: null, error: failure(options.error, 'invalid_listing') }
  const previewError = await validatePublicPreview(preview?.blob, preview?.durationSeconds)
  if (previewError) return { listing: null, error: failure(previewError, 'invalid_preview') }
  const { user, error } = await authenticatedUser()
  if (error) return { listing: null, error }
  const source = await ownedVersion(preview.versionId, user.id)
  if (source.error) return { listing: null, error: source.error }
  if (source.version.recording_id !== preview.recordingId) return { listing: null, error: failure('Generate a preview for the selected version again.', 'invalid_preview') }
  const existing = await listingForVersion(preview.versionId)
  if (existing.error) return { listing: null, error: existing.error }
  if (existing.listing) return { listing: null, error: failure('This version already has a listing. Check My listings.', 'duplicate_listing') }
  if (typeof globalThis.crypto?.randomUUID !== 'function') return { listing: null, error: failure('A secure preview filename could not be generated.', 'secure_random_unavailable') }
  const path = `${user.id}/${globalThis.crypto.randomUUID()}.wav`
  try {
    const { error: uploadError } = await supabase.storage.from(PREVIEW_BUCKET).upload(path, preview.blob, { contentType: 'audio/wav', upsert: false })
    if (uploadError) return { listing: null, error: previewUploadFailure(uploadError, preview) }
  } catch (uploadError) {
    return { listing: null, error: previewUploadFailure(uploadError, preview, true) }
  }
  try {
    const { data, error: rpcError } = await supabase.rpc('publish_voice_listing', {
      p_version_id: preview.versionId,
      p_preview_path: path,
      p_preview_duration_seconds: preview.durationSeconds,
      p_sale_price_cents: options.salePriceCents,
      p_rental_price_cents: options.rentalPriceCents,
      p_make_public: publicConfirmed,
      p_rights_confirmed: rightsConfirmed,
    })
    if (rpcError) return reconcilePublication(preview.versionId, path, mapError(rpcError, 'publish'))
    if (!isUuid(data)) return reconcilePublication(preview.versionId, path, failure('The publish response was incomplete.', 'verification_failed', true))
    return { listing: { id: data, version_id: preview.versionId, preview_path: path, status: 'published' }, error: null }
  } catch {
    return reconcilePublication(preview.versionId, path, failure('The publish result could not be confirmed.', 'network_outcome_unknown', true))
  }
}

export async function listMyListings() {
  const { user, error } = await authenticatedUser()
  if (error) return { listings: null, error }
  try {
    const result = await supabase.from('listings').select(LISTING_FIELDS)
      .eq('version.recording.owner_id', user.id).order('created_at', { ascending: false })
    if (result.error) return { listings: null, error: mapError(result.error) }
    // Also fail closed if an unexpected join result lacks verified ownership.
    return { listings: (result.data ?? []).filter((listing) => listing.version?.recording?.owner_id === user.id), error: null }
  } catch {
    return { listings: null, error: failure('Your listings could not be loaded. Check your connection and try again.') }
  }
}

export async function archiveMyListing(listingId) {
  const { user, error } = await authenticatedUser()
  if (error) return { listing: null, error }
  if (!isUuid(listingId)) return { listing: null, error: failure('Choose a valid listing.', 'invalid_listing') }
  try {
    const owned = await supabase.from('listings').select(LISTING_FIELDS)
      .eq('id', listingId).eq('version.recording.owner_id', user.id).maybeSingle()
    if (owned.error) return { listing: null, error: mapError(owned.error) }
    if (owned.data?.version?.recording?.owner_id !== user.id) return { listing: null, error: failure('Only your own listings can be archived.', 'access_denied') }
    const result = await supabase.from('listings').update({ status: 'archived' }).eq('id', listingId).select('id,status').single()
    return { listing: result.data ?? null, error: result.error ? mapError(result.error) : !result.data ? failure('Archival was not confirmed. Refresh My listings.') : null }
  } catch {
    return { listing: null, error: failure('Archival could not be confirmed. Refresh My listings before trying again.', 'network_outcome_unknown', true) }
  }
}

export function getPublicPreviewUrl(path) {
  if (!supabase || typeof path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.wav$/i.test(path)) return null
  const [owner, filename] = path.split('/')
  if (!isUuid(owner) || !isUuid(filename.slice(0, -4))) return null
  return supabase.storage.from(PREVIEW_BUCKET).getPublicUrl(path).data?.publicUrl ?? null
}
