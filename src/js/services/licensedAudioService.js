import { configurationError, supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'
import { MAX_AUDIO_FILE_SIZE_BYTES, normalizeAudioMimeType } from '../utils/audioUploadValidation.js'

// Resolve the exact immutable license → listing → version relationship on demand.
// RLS hides a version unless the caller owns it or has a DB-time-valid license.
const AUDIO_FIELDS = 'id,buyer_id,listing_id,license_type,listing:listings(id,version_id,version:voice_versions(id,storage_path,mime_type,file_size_bytes,recording:voice_recordings(title)))'

function denied(message, code) {
  return { audio: null, error: { message, code } }
}

function requestError(error) {
  const status = Number(error?.status ?? error?.statusCode)
  if (status === 401 || error?.code === 'PGRST301' || error?.code === 'PGRST303') {
    return denied('Your session has expired. Sign in again to access licensed audio.', 'authentication_required')
  }
  if (status === 403 || error?.code === '42501') {
    return denied('You are not authorized to access this full audio. Refresh your licenses and sign in again if needed.', 'access_denied')
  }
  if (status === 404 || error?.code === 'NoSuchKey') {
    return denied('This audio file is unavailable. Refresh your licenses or try again later.', 'file_unavailable')
  }
  // Storage may mask a missing/denied object as 400; do not reveal object paths
  // or assume that this response proves either existence or authorization.
  if (status === 400) {
    return denied('This file is unavailable or access has expired. Refresh your licenses and try again.', 'file_unavailable')
  }
  return denied('The licensed audio could not be loaded. Check your connection and try again.', 'download_failed')
}

async function verifiedUser() {
  try {
    const { data, error } = await supabase.auth.getUser()
    return !error && isUuid(data?.user?.id) ? data.user : null
  } catch {
    return null
  }
}

function audioDescriptor(version) {
  const type = normalizeAudioMimeType(version?.mime_type)
  const path = version?.storage_path
  const match = typeof path === 'string'
    ? /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(wav|mp3|m4a|ogg|webm|weba)$/i.exec(path)
    : null
  if (!type || !match || !isUuid(match[1]) || !isUuid(match[2])) return null
  const extension = match[3].toLowerCase()
  if (extension !== type.extension && !(type.extension === 'webm' && extension === 'weba')) return null
  if (!Number.isSafeInteger(version.file_size_bytes) || version.file_size_bytes <= 0
    || version.file_size_bytes > MAX_AUDIO_FILE_SIZE_BYTES) return null
  const title = typeof version.recording?.title === 'string' && version.recording.title.trim()
    ? version.recording.title.trim() : 'Licensed voice recording'
  const base = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'echovault-recording'
  return { path, type, title, filename: `${base}.${extension}` }
}

export async function getLicensedAudio(licenseId) {
  if (!isUuid(licenseId)) return denied('Choose a valid acquired license.', 'invalid_license')
  if (!supabase) return denied(configurationError || 'Supabase is not configured.', 'configuration')
  const user = await verifiedUser()
  if (!user) return denied('Sign in again to access your licensed full audio.', 'authentication_required')
  try {
    // Caller-provided paths, user IDs, expiry dates, and status are never used.
    const { data: license, error } = await supabase.from('licenses').select(AUDIO_FIELDS)
      .eq('id', licenseId).eq('buyer_id', user.id).maybeSingle()
    if (error) return requestError(error)
    if (license?.id !== licenseId || license?.buyer_id !== user.id
      || !isUuid(license?.listing_id) || !['buy', 'rent'].includes(license?.license_type)) {
      return denied('This license is unavailable or belongs to another account.', 'access_denied')
    }
    if (license.listing && license.listing.id !== license.listing_id) {
      return denied('The licensed listing could not be verified.', 'access_denied')
    }
    const version = license.listing?.version
    if (!version) {
      // The own receipt remains readable. RLS can hide the version and also an
      // archived listing when no DB-time-valid license remains for that version.
      return license.license_type === 'rent'
        ? denied('This rental has expired or no longer authorizes full audio access. Refresh your licenses.', 'license_expired')
        : denied('This license no longer authorizes access to the full audio.', 'access_denied')
    }
    if (!isUuid(version.id) || version.id !== license.listing.version_id) {
      return denied('The licensed audio version could not be verified.', 'access_denied')
    }
    const descriptor = audioDescriptor(version)
    if (!descriptor) return denied('The saved audio format or file metadata is unavailable.', 'invalid_audio')

    // Authenticated delivery rechecks Storage RLS at request time, including
    // expiry between the metadata query and download. No bearer signed URL.
    const result = await supabase.storage.from('voice-files').download(descriptor.path)
    if (result.error) return requestError(result.error)
    const blob = result.data
    if (!(blob instanceof Blob) || blob.size !== version.file_size_bytes) {
      return denied('The audio file is missing, empty, or incomplete. Please try again later.', 'file_unavailable')
    }
    const downloadedType = normalizeAudioMimeType(blob.type)
    const genericType = !blob.type || blob.type.toLowerCase() === 'application/octet-stream'
    if (!genericType && (!downloadedType || downloadedType.extension !== descriptor.type.extension)) {
      return denied('The downloaded file does not match its saved audio format.', 'invalid_audio')
    }
    // Discard a response that completed after signout, account switch, or loss
    // of the verified session. The UI also invalidates pending auth transitions.
    const currentUser = await verifiedUser()
    if (currentUser?.id !== user.id) {
      return denied('Your session changed or expired. Sign in again to access licensed audio.', 'authentication_required')
    }
    return {
      audio: {
        blob: genericType ? blob.slice(0, blob.size, descriptor.type.mimeType) : blob,
        title: descriptor.title, filename: descriptor.filename, versionId: version.id,
      },
      error: null,
    }
  } catch {
    return requestError(null)
  }
}
