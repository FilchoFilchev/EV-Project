import { configurationError, supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'

const LICENSE_FIELDS = 'id,listing_id,buyer_id,license_type,price_cents,created_at,expires_at'
const RECEIPT_FIELDS = `${LICENSE_FIELDS},listing:listings(id,status,version:voice_versions(recording:voice_recordings(title)))`
const PAGE_SIZE = 200

function failure(message, code = 'license_error', outcomeUnknown = false) {
  return { message, code, outcomeUnknown }
}

function mapError(error, checkout = false) {
  const status = Number(error?.status ?? error?.statusCode)
  if (error?.code === '42501' || status === 401 || status === 403) {
    return failure('You are not authorized to complete this Demo Checkout. Sign in as a buyer other than the creator.', 'access_denied')
  }
  if (error?.code === '23505') return failure('You already own a permanent license for this listing. Another purchase or rental is not needed.', 'duplicate_purchase')
  if (error?.code === 'P0002') return failure('This listing is no longer available for Demo Checkout. Refresh the listing.', 'listing_unavailable')
  if (['22023', '23514'].includes(error?.code)) return failure('The selected sale or rental offer is unavailable. Refresh the listing and choose an available offer.', 'offer_unavailable')
  if (['PGRST202', 'PGRST204', '42703', '42883'].includes(error?.code)) {
    return failure('Demo Checkout requires the Prompt 15 database migration in echovault-dev. Ask the project owner to apply it.', 'setup_required')
  }
  // A PostgreSQL exception rolls back the RPC. Network/server transport failures
  // may lose a response after commit, so never issue an automatic second checkout.
  const definitive = /^[0-9A-Z]{5}$/.test(error?.code ?? '') || (Number.isInteger(status) && status >= 400 && status < 500)
  return failure(checkout
    ? definitive ? 'Demo Checkout failed. No license was issued by this transaction. Please try again.'
      : 'The Demo Checkout result could not be confirmed. Check Acquired licenses in My Library before retrying.'
    : 'Your licenses could not be loaded. Check your connection and try again.',
  checkout && !definitive ? 'checkout_outcome_unknown' : 'license_error', checkout && !definitive)
}

async function authenticatedUser() {
  if (!supabase) return { user: null, error: failure(configurationError || 'Supabase is not configured.', 'configuration') }
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !isUuid(data?.user?.id)) return { user: null, error: failure('Sign in to use Demo Checkout and view your licenses.', 'authentication_required') }
    return { user: data.user, error: null }
  } catch {
    return { user: null, error: failure('Your sign-in could not be verified. Please try again.', 'authentication_error') }
  }
}

function ownLicense(row, buyerId) {
  return row?.buyer_id === buyerId && isUuid(row.id) && isUuid(row.listing_id)
    && ['buy', 'rent'].includes(row.license_type)
    && Number.isSafeInteger(row.price_cents) && row.price_cents > 0
    && typeof row.created_at === 'string'
    && (row.license_type === 'buy' ? row.expires_at === null : typeof row.expires_at === 'string')
}

async function matchingLicenses(userId, listingId, licenseType) {
  try {
    const { data, error } = await supabase.from('licenses').select(LICENSE_FIELDS)
      .eq('buyer_id', userId).eq('listing_id', listingId).eq('license_type', licenseType)
      .order('created_at', { ascending: false })
    if (error) return { licenses: null, error: mapError(error) }
    return { licenses: (data ?? []).filter((row) => ownLicense(row, userId)
      && row.listing_id === listingId && row.license_type === licenseType), error: null }
  } catch {
    return { licenses: null, error: mapError(null) }
  }
}

async function reconcileCheckout(userId, listingId, licenseType, previousIds, error) {
  if (!error.outcomeUnknown) return { licenseId: null, error }
  const result = await matchingLicenses(userId, listingId, licenseType)
  // A previously stored rental might be expired. Only a new receipt proves that
  // checkout occurred; browser time never determines whether a rental is valid.
  const issued = result.licenses?.find((row) => !previousIds.has(row.id))
  if (issued) return { licenseId: issued.id, error: null }
  return { licenseId: null, error }
}

export async function demoCheckout({ listingId, licenseType } = {}) {
  if (!isUuid(listingId) || !['buy', 'rent'].includes(licenseType)) {
    return { licenseId: null, error: failure('Choose a valid listing and either Demo Buy or Demo Rent.', 'invalid_checkout') }
  }
  const { user, error } = await authenticatedUser()
  if (error) return { licenseId: null, error }
  const before = await matchingLicenses(user.id, listingId, licenseType)
  if (before.error) return { licenseId: null, error: before.error }
  const previousIds = new Set(before.licenses.map((row) => row.id))
  try {
    // Price, seller, buyer and expiry are deliberately absent. The database
    // resolves the verified caller and all checkout conditions transactionally.
    const result = await supabase.rpc('demo_checkout', {
      p_listing_id: listingId,
      p_license_type: licenseType,
    })
    if (result.error) return reconcileCheckout(user.id, listingId, licenseType, previousIds, mapError(result.error, true))
    if (!isUuid(result.data)) return reconcileCheckout(user.id, listingId, licenseType, previousIds,
      failure('The Demo Checkout response was incomplete. Check Acquired licenses in My Library before retrying.', 'checkout_outcome_unknown', true))
    return { licenseId: result.data, error: null }
  } catch {
    return reconcileCheckout(user.id, listingId, licenseType, previousIds, mapError(null, true))
  }
}

export async function getMyLicense(licenseId) {
  if (!isUuid(licenseId)) return { license: null, error: failure('Choose a valid license.', 'invalid_license') }
  const { user, error } = await authenticatedUser()
  if (error) return { license: null, error }
  try {
    const result = await supabase.from('licenses').select(RECEIPT_FIELDS)
      .eq('id', licenseId).eq('buyer_id', user.id).maybeSingle()
    if (result.error) return { license: null, error: mapError(result.error) }
    if (!ownLicense(result.data, user.id) || result.data.id !== licenseId) {
      return { license: null, error: failure('This license is unavailable or belongs to another account.', 'access_denied') }
    }
    return { license: result.data, error: null }
  } catch {
    return { license: null, error: mapError(null) }
  }
}

export async function listMyLicenses() {
  const { user, error } = await authenticatedUser()
  if (error) return { licenses: null, error }
  const licenses = []
  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await supabase.from('licenses').select(RECEIPT_FIELDS)
        .eq('buyer_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (result.error) return { licenses: null, error: mapError(result.error) }
      const rows = result.data ?? []
      licenses.push(...rows.filter((row) => ownLicense(row, user.id)))
      if (rows.length < PAGE_SIZE) return { licenses, error: null }
    }
  } catch {
    return { licenses: null, error: mapError(null) }
  }
}
