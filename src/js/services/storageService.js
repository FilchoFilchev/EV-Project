import { configurationError, supabase } from '../config/supabaseClient.js'
import {
  MAX_AUDIO_FILE_SIZE_BYTES,
  normalizeAudioMimeType,
} from '../utils/audioUploadValidation.js'

const AUDIO_BUCKET = 'voice-files'

function serviceError(message, code = 'storage_error', outcomeUnknown = false) {
  return { message, code, outcomeUnknown }
}

function getStorageError(error, operation) {
  const status = Number(error?.status ?? error?.statusCode)
  if (status === 401 || status === 403 || error?.code === '42501') {
    return serviceError('You are not authorized to access this audio file.', 'access_denied')
  }

  if (status === 413 || error?.code === '413') {
    return serviceError('Audio files must be 20 MiB or smaller.', 'file_too_large')
  }

  if (operation === 'upload') {
    return serviceError(
      'The audio could not be uploaded. Check your connection and try again.',
      'upload_failed',
      !Number.isInteger(status) || status >= 500
    )
  }

  if (operation === 'cleanup') {
    return serviceError(
      'The unreferenced upload could not be safely removed.',
      'cleanup_failed',
      true
    )
  }

  return serviceError(
    'The saved audio could not be downloaded. Check your connection and access, then try again.',
    'download_failed'
  )
}

function createUuid() {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  if (typeof cryptoApi?.getRandomValues !== 'function') {
    return null
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function getAuthenticatedUserId() {
  if (!supabase) {
    return { userId: null, error: serviceError(configurationError, 'configuration') }
  }

  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.id) {
      return {
        userId: null,
        error: serviceError('Sign in before saving or accessing audio.', 'authentication_required'),
      }
    }

    return { userId: data.user.id, error: null }
  } catch {
    return {
      userId: null,
      error: serviceError('Your sign-in could not be verified. Please try again.', 'authentication_error'),
    }
  }
}

export async function uploadOriginalAudio(blob, mimeType) {
  if (!supabase) {
    return { path: null, error: serviceError(configurationError, 'configuration') }
  }

  const normalizedType = normalizeAudioMimeType(mimeType)
  if (
    !blob ||
    !normalizedType ||
    !Number.isSafeInteger(blob.size) ||
    blob.size <= 0 ||
    blob.size > MAX_AUDIO_FILE_SIZE_BYTES
  ) {
    return {
      path: null,
      error: serviceError('The selected audio is not valid or exceeds the 20 MiB limit.', 'invalid_audio'),
    }
  }

  const { userId, error: userError } = await getAuthenticatedUserId()
  if (userError) {
    return { path: null, error: userError }
  }

  const fileId = createUuid()
  if (!fileId) {
    return {
      path: null,
      error: serviceError('A secure upload filename could not be generated.', 'secure_random_unavailable'),
    }
  }

  const path = `${userId}/${fileId}.${normalizedType.extension}`

  try {
    const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, blob, {
      contentType: normalizedType.mimeType,
      upsert: false,
    })

    if (error) {
      return { path, error: getStorageError(error, 'upload') }
    }

    return { path, error: null }
  } catch {
    return {
      path,
      error: serviceError(
        'The upload result could not be confirmed. EchoVault will check for an unreferenced file before cleanup.',
        'upload_outcome_unknown',
        true
      ),
    }
  }
}

export async function uploadEditedAudio(blob) {
  if (blob?.type !== 'audio/wav') {
    return { path: null, error: serviceError('Edited audio must be a rendered WAV file.', 'invalid_audio') }
  }
  return uploadOriginalAudio(blob, 'audio/wav')
}

export async function removeUnreferencedAudio(path) {
  if (!supabase || typeof path !== 'string' || !path) {
    return {
      removed: false,
      error: serviceError(configurationError || 'The audio path is invalid.', 'invalid_path'),
    }
  }

  try {
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).remove([path])
    if (error) {
      return { removed: false, error: getStorageError(error, 'cleanup') }
    }

    const confirmed = Array.isArray(data) && data.some((object) => object?.name === path)
    if (!confirmed) {
      return {
        removed: false,
        error: serviceError(
          'Storage did not confirm removal of the unreferenced upload.',
          'cleanup_unconfirmed',
          true
        ),
      }
    }

    return { removed: true, error: null }
  } catch {
    return {
      removed: false,
      error: serviceError(
        'The cleanup result could not be confirmed. The unreferenced file may remain in private Storage.',
        'cleanup_outcome_unknown',
        true
      ),
    }
  }
}

export async function downloadOriginalAudio(path) {
  if (!supabase || typeof path !== 'string' || !path) {
    return {
      blob: null,
      error: serviceError(configurationError || 'The audio path is invalid.', 'invalid_path'),
    }
  }

  try {
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path)
    if (error || !data) {
      return { blob: null, error: getStorageError(error, 'download') }
    }

    return { blob: data, error: null }
  } catch {
    return {
      blob: null,
      error: serviceError('The audio could not be downloaded. Check your connection and try again.', 'download_failed'),
    }
  }
}
