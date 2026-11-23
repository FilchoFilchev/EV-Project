export const PREVIEW_SAMPLE_RATE = 16000
export const MIN_PREVIEW_SECONDS = 5
export const MAX_PREVIEW_SECONDS = 8
export const MAX_PREVIEW_FILE_SIZE_BYTES = 44 + MAX_PREVIEW_SECONDS * PREVIEW_SAMPLE_RATE * 2
export const MAX_PRICE_CENTS = 2147483647

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export function parseEuroPrice(value) {
  if (typeof value !== 'string') return { cents: null, error: 'Enter a euro amount with at most two decimal places.' }
  const amount = value.trim()
  if (!amount) return { cents: null, error: null }
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(amount)) {
    return { cents: null, error: 'Enter a positive euro amount with at most two decimal places.' }
  }
  const [euros, fraction = ''] = amount.replace(',', '.').split('.')
  // Decimal strings are converted to integer cents without floating-point multiplication.
  const cents = Number(euros) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_PRICE_CENTS) {
    return { cents: null, error: 'Prices must be between €0.01 and €21,474,836.47.' }
  }
  return { cents, error: null }
}

export function validateListingOptions({ salePrice, rentalPrice, rightsConfirmed, publicConfirmed }) {
  const sale = parseEuroPrice(salePrice)
  const rental = parseEuroPrice(rentalPrice)
  if (sale.error) return { error: `Sale price: ${sale.error}` }
  if (rental.error) return { error: `Rental price: ${rental.error}` }
  if (sale.cents === null && rental.cents === null) return { error: 'Enter a sale price, a 30-day rental price, or both.' }
  if (rightsConfirmed !== true) return { error: 'Confirm that you have the rights and consent to publish this voice.' }
  if (publicConfirmed !== true) return { error: 'Confirm that the source recording details and short preview may be public.' }
  return { salePriceCents: sale.cents, rentalPriceCents: rental.cents, error: null }
}

export function validatePreviewSelection(startSeconds, durationSeconds) {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) return 'Choose a valid non-negative preview start time.'
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_PREVIEW_SECONDS || durationSeconds > MAX_PREVIEW_SECONDS ||
      Math.abs(durationSeconds * 1000 - Math.round(durationSeconds * 1000)) > 0.000001) {
    return 'Preview length must be between 5 and 8 seconds (at most three decimal places).'
  }
  return null
}

export async function validatePublicPreview(blob, durationSeconds) {
  const selectionError = validatePreviewSelection(0, durationSeconds)
  if (selectionError) return selectionError
  const expectedSize = 44 + Math.round(durationSeconds * PREVIEW_SAMPLE_RATE) * 2
  if (blob?.type !== 'audio/wav' || typeof blob.arrayBuffer !== 'function' ||
      blob.size !== expectedSize || blob.size > MAX_PREVIEW_FILE_SIZE_BYTES) {
    return 'Generate a valid 5–8 second WAV preview before publishing.'
  }
  try {
    const bytes = await blob.arrayBuffer()
    if (bytes.byteLength !== expectedSize) return 'The preview file size is invalid.'
    const header = new DataView(bytes)
    const text = (offset, value) => Array.from(value).every((character, index) => header.getUint8(offset + index) === character.charCodeAt(0))
    if (!text(0, 'RIFF') || !text(8, 'WAVE') || !text(12, 'fmt ') || !text(36, 'data') ||
        header.getUint32(4, true) !== bytes.byteLength - 8 || header.getUint32(16, true) !== 16 ||
        header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 1 ||
        header.getUint32(24, true) !== PREVIEW_SAMPLE_RATE || header.getUint32(28, true) !== PREVIEW_SAMPLE_RATE * 2 ||
        header.getUint16(32, true) !== 2 || header.getUint16(34, true) !== 16 ||
        header.getUint32(40, true) !== bytes.byteLength - 44) {
      return 'Generate a new preview: the WAV format or duration is invalid.'
    }
    return null
  } catch {
    return 'The preview file could not be read. Generate it again.'
  }
}
