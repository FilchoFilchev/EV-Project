export const MAX_AUDIO_FILE_SIZE_BYTES = 20 * 1024 * 1024

const SUPPORTED_AUDIO_TYPES = new Map([
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
])

export function normalizeAudioMimeType(value) {
  if (typeof value !== 'string') {
    return null
  }

  const mimeType = value.split(';', 1)[0].trim().toLowerCase()
  const extension = SUPPORTED_AUDIO_TYPES.get(mimeType)
  return extension ? { mimeType, extension } : null
}

export function validateOriginalAudio({ blob, durationSeconds, title, category, description }) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  const normalizedCategory = typeof category === 'string' ? category.trim() : ''

  if (!normalizedTitle || Array.from(normalizedTitle).length > 120) {
    return { error: 'Enter a title between 1 and 120 characters.' }
  }

  if (!normalizedCategory || Array.from(normalizedCategory).length > 80) {
    return { error: 'Enter a category between 1 and 80 characters.' }
  }

  if (!blob || !Number.isSafeInteger(blob.size) || blob.size <= 0) {
    return { error: 'Choose a non-empty audio recording or file before saving.' }
  }

  if (blob.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    return { error: 'Audio files must be 20 MiB or smaller.' }
  }

  const audioType = normalizeAudioMimeType(blob.type)
  if (!audioType) {
    return {
      error:
        'This audio format cannot be saved. Choose WAV, MP3, M4A, OGG, or WebM audio supported by your browser.',
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      error: 'The audio duration could not be read. Play or reselect the audio, then try again.',
    }
  }

  if (durationSeconds > 9999999.999) {
    return { error: 'This recording is too long to save.' }
  }

  return {
    error: null,
    title: normalizedTitle,
    category: normalizedCategory,
    description: typeof description === 'string' ? description.trim() : '',
    mimeType: audioType.mimeType,
    extension: audioType.extension,
    fileSizeBytes: blob.size,
    durationSeconds,
  }
}
