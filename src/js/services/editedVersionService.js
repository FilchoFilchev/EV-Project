import { renderAudioWav } from './audioEngine.js'
import { getPremiumEligibility } from './subscriptionService.js'
import { uploadEditedAudio, removeUnreferencedAudio } from './storageService.js'
import { createEditedVersion, findOwnedEditedVersionByPath } from './voiceRecordingService.js'

function failure(message, outcomeUnknown = false) {
  return { version: null, error: { message, outcomeUnknown } }
}

async function reconcile(path, message, outcomeUnknown) {
  const verification = await findOwnedEditedVersionByPath(path)
  if (verification.version) return { version: verification.version, error: null }

  // A lost response may still commit later. Never remove its audio or invite a duplicate retry.
  if (verification.error || outcomeUnknown) {
    return failure(`${message} The result is uncertain. Check Edited versions in My Library before retrying.`, true)
  }

  const cleanup = await removeUnreferencedAudio(path)
  return cleanup.removed
    ? failure(`${message} The unreferenced upload was removed. You can try again.`)
    : failure(`${message} Cleanup could not be confirmed. Check My Library before retrying.`, true)
}

export async function saveEditedAudio({ recordingId, sourceBlob, effectType, intensity, onProgress = () => {} }) {
  if (!recordingId || !sourceBlob || !['muffle', 'distortion', 'echo'].includes(effectType)) {
    return failure('Save the original and choose Muffle, Distortion, or Echo before saving an edited version.')
  }

  let uploadPath = null
  let metadataStarted = false
  try {
    const eligibility = await getPremiumEligibility()
    if (eligibility.error || !eligibility.premium) {
      return failure(eligibility.error || 'An active Premium subscription is required to save edited versions.')
    }

    onProgress('Rendering your selected effect to WAV...')
    const rendered = await renderAudioWav(sourceBlob, { effectType, intensity })
    onProgress('Uploading the private WAV and saving its effect settings...')
    const upload = await uploadEditedAudio(rendered.blob)
    uploadPath = upload.path
    if (upload.error) {
      return upload.path && upload.error.outcomeUnknown
        ? await reconcile(upload.path, upload.error.message, false)
        : failure(upload.error.message)
    }

    metadataStarted = true
    const result = await createEditedVersion({ ...rendered, recordingId, storagePath: upload.path })
    if (result.version) return result
    return await reconcile(upload.path, result.error?.message || 'The edited version could not be saved.', Boolean(result.error?.outcomeUnknown))
  } catch (error) {
    if (uploadPath) return reconcile(uploadPath, 'The edited save could not be confirmed.', metadataStarted)
    return failure(error instanceof Error ? error.message : 'The edited WAV could not be rendered. Try another audio file.')
  }
}
