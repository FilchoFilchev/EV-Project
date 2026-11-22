import { configurationError, supabase } from '../config/supabaseClient.js'
import { validateOriginalAudio } from '../utils/audioUploadValidation.js'

function serviceError(message, code = 'database_error', outcomeUnknown = false) {
  return { message, code, outcomeUnknown }
}

function mapDatabaseError(error, outcomeUnknown = false) {
  if (error?.code === '42501' || error?.status === 401 || error?.status === 403) {
    return serviceError('You are not authorized to save or view this recording.', 'access_denied')
  }

  if (error?.code === '23505') {
    return serviceError(
      'This recording already has an original version. Refresh your library before trying again.',
      'duplicate_original'
    )
  }

  if (error?.code === '22023' || error?.code === '23514') {
    return serviceError(
      'The recording details or audio do not meet the storage requirements. Review them and try again.',
      'invalid_recording'
    )
  }

  return serviceError(
    'The recording could not be saved or verified. Check your connection and My Library before retrying.',
    error?.code || 'database_error',
    outcomeUnknown
  )
}

function rpcOutcomeMayBeUnknown(error) {
  const status = Number(error?.status)
  return !(Number.isInteger(status) && status >= 400 && status < 500)
}

async function getAuthenticatedUser() {
  if (!supabase) {
    return { user: null, error: serviceError(configurationError, 'configuration') }
  }

  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.id) {
      return {
        user: null,
        error: serviceError('Sign in before saving or viewing your library.', 'authentication_required'),
      }
    }

    return { user: data.user, error: null }
  } catch {
    return {
      user: null,
      error: serviceError('Your sign-in could not be verified. Please try again.', 'authentication_error'),
    }
  }
}

export async function findOwnedOriginalByPath(storagePath) {
  if (!supabase) {
    return { recording: null, error: serviceError(configurationError, 'configuration') }
  }

  if (typeof storagePath !== 'string' || !storagePath) {
    return {
      recording: null,
      error: serviceError('The recording path is invalid.', 'invalid_path'),
    }
  }

  try {
    const { data: version, error: versionError } = await supabase
      .from('voice_versions')
      .select('id,recording_id,effect_type,storage_path,duration_seconds,mime_type,file_size_bytes,created_at')
      .eq('storage_path', storagePath)
      .eq('effect_type', 'original')
      .maybeSingle()

    if (versionError) {
      return { recording: null, error: mapDatabaseError(versionError, true) }
    }
    if (!version) {
      return { recording: null, error: null }
    }

    const { user, error: userError } = await getAuthenticatedUser()
    if (userError) {
      return { recording: null, error: userError }
    }

    const { data: row, error: recordingError } = await supabase
      .from('voice_recordings')
      .select('id,owner_id,title,description,category,created_at')
      .eq('id', version.recording_id)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (recordingError) {
      return { recording: null, error: mapDatabaseError(recordingError, true) }
    }
    if (!row) {
      return {
        recording: null,
        error: serviceError('The save result could not be verified. Check My Library before retrying.', 'verification_failed', true),
      }
    }

    return { recording: { ...row, original: version }, error: null }
  } catch {
    return {
      recording: null,
      error: serviceError('The save result could not be verified. Check My Library before retrying.', 'verification_failed', true),
    }
  }
}

export async function createOriginalRecording(metadata) {
  if (!supabase) {
    return { recording: null, error: serviceError(configurationError, 'configuration') }
  }

  if (typeof metadata?.storagePath !== 'string' || !metadata.storagePath) {
    return {
      recording: null,
      error: serviceError('The uploaded audio path is invalid.', 'invalid_path'),
    }
  }

  const validated = validateOriginalAudio(metadata ?? {})
  if (validated.error) {
    return { recording: null, error: serviceError(validated.error, 'invalid_recording') }
  }

  try {
    const { data, error } = await supabase.rpc('create_original_voice_recording', {
      p_title: validated.title,
      p_category: validated.category,
      p_description: typeof metadata.description === 'string' ? metadata.description.trim() : '',
      p_storage_path: metadata.storagePath,
      p_mime_type: validated.mimeType,
      p_file_size_bytes: validated.fileSizeBytes,
      p_duration_seconds: validated.durationSeconds,
    })

    if (error) {
      return {
        recording: null,
        error: mapDatabaseError(error, rpcOutcomeMayBeUnknown(error)),
      }
    }

    const result = Array.isArray(data) ? data[0] : data
    if (!result?.recording_id || !result?.version_id) {
      return {
        recording: null,
        error: serviceError('The save result could not be confirmed. Check My Library before retrying.', 'verification_failed', true),
      }
    }

    const verification = await findOwnedOriginalByPath(metadata.storagePath)
    if (verification.error) {
      return { recording: null, error: verification.error }
    }

    if (
      !verification.recording ||
      verification.recording.id !== result.recording_id ||
      verification.recording.original.id !== result.version_id
    ) {
      return {
        recording: null,
        error: serviceError('The save result could not be confirmed. Check My Library before retrying.', 'verification_failed', true),
      }
    }

    return verification
  } catch {
    return {
      recording: null,
      error: serviceError(
        'The save result could not be confirmed. Check My Library before retrying.',
        'network_outcome_unknown',
        true
      ),
    }
  }
}

export async function listMyOriginalRecordings() {
  if (!supabase) {
    return { recordings: null, error: serviceError(configurationError, 'configuration') }
  }

  const { user, error: userError } = await getAuthenticatedUser()
  if (userError) {
    return { recordings: null, error: userError }
  }

  try {
    const { data: rows, error } = await supabase
      .from('voice_recordings')
      .select('id,title,description,category,created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return { recordings: null, error: mapDatabaseError(error) }
    }
    if (!rows?.length) {
      return { recordings: [], error: null }
    }

    const recordingIds = rows.map((row) => row.id)
    const { data: versions, error: versionsError } = await supabase
      .from('voice_versions')
      .select('id,recording_id,storage_path,duration_seconds,mime_type,file_size_bytes,created_at')
      .in('recording_id', recordingIds)
      .eq('effect_type', 'original')

    if (versionsError) {
      return { recordings: null, error: mapDatabaseError(versionsError) }
    }

    const versionsByRecordingId = new Map(
      (versions ?? []).map((version) => [version.recording_id, version])
    )

    return {
      recordings: rows.map((row) => ({
        ...row,
        original: versionsByRecordingId.get(row.id) ?? null,
      })),
      error: null,
    }
  } catch {
    return {
      recordings: null,
      error: serviceError('Your library could not be loaded. Check your connection and try again.', 'library_load_failed'),
    }
  }
}

export async function findOwnedEditedVersionByPath(storagePath) {
  const { user, error: userError } = await getAuthenticatedUser()
  if (userError) return { version: null, error: userError }

  try {
    const { data, error } = await supabase
      .from('voice_versions')
      .select('id,recording_id,effect_type,effect_settings,storage_path,duration_seconds,mime_type,file_size_bytes,created_at,recording:voice_recordings!inner(id,owner_id,title,category)')
      .eq('storage_path', storagePath)
      .neq('effect_type', 'original')
      .eq('recording.owner_id', user.id)
      .maybeSingle()
    return { version: data ?? null, error: error ? mapDatabaseError(error, true) : null }
  } catch {
    return { version: null, error: serviceError('The edited save could not be verified. Check My Library.', 'verification_failed', true) }
  }
}

export async function createEditedVersion({ recordingId, storagePath, blob, durationSeconds, effectType, effectSettings }) {
  const { user, error: userError } = await getAuthenticatedUser()
  if (userError) return { version: null, error: userError }

  const validated = validateOriginalAudio({ blob, durationSeconds, title: 'Edited version', category: 'Audio' })
  if (validated.error || validated.mimeType !== 'audio/wav' ||
      !/^[0-9a-f-]{36}$/i.test(recordingId ?? '') ||
      typeof storagePath !== 'string' || !storagePath.startsWith(`${user.id}/`) ||
      !['muffle', 'distortion', 'echo'].includes(effectType) ||
      !Number.isInteger(effectSettings?.intensity) || effectSettings.intensity < 0 || effectSettings.intensity > 100) {
    return { version: null, error: serviceError(validated.error || 'Choose a valid effect and rendered WAV before saving.', 'invalid_recording') }
  }

  try {
    const { data, error } = await supabase.from('voice_versions').insert({
      recording_id: recordingId,
      effect_type: effectType,
      effect_settings: effectSettings,
      storage_path: storagePath,
      duration_seconds: durationSeconds,
      mime_type: 'audio/wav',
      file_size_bytes: blob.size,
    }).select('id,recording_id,effect_type,effect_settings,storage_path,duration_seconds,mime_type,file_size_bytes,created_at').single()

    if (error) return { version: null, error: mapDatabaseError(error, rpcOutcomeMayBeUnknown(error)) }
    if (!data?.id) return { version: null, error: serviceError('The edited save could not be confirmed. Check My Library.', 'verification_failed', true) }
    return { version: data, error: null }
  } catch {
    return { version: null, error: serviceError('The edited save could not be confirmed. Check My Library.', 'network_outcome_unknown', true) }
  }
}

export async function listMyEditedVersions() {
  const { user, error: userError } = await getAuthenticatedUser()
  if (userError) return { versions: null, error: userError }

  try {
    const { data, error } = await supabase
      .from('voice_versions')
      .select('id,recording_id,effect_type,effect_settings,storage_path,duration_seconds,mime_type,file_size_bytes,created_at,recording:voice_recordings!inner(id,owner_id,title,category,description,created_at)')
      .eq('recording.owner_id', user.id)
      .neq('effect_type', 'original')
      .order('created_at', { ascending: false })
    return { versions: data ?? [], error: error ? mapDatabaseError(error) : null }
  } catch {
    return { versions: null, error: serviceError('Your edited versions could not be loaded. Check your connection and try again.', 'library_load_failed') }
  }
}
