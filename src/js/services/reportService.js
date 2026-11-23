import { supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'
import { mapModerationError, moderationFailure, verifiedModerationUser } from './moderationClient.js'

const REPORT_FIELDS = 'id,listing_id,reporter_id,status,created_at,resolved_at'
const unsupportedControls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/

export async function getMyListingReport(listingId) {
  if (!isUuid(listingId)) return { report: null, error: moderationFailure('Choose a valid listing.', 'invalid_listing') }
  const { user, error } = await verifiedModerationUser()
  if (error) return { report: null, error }
  try {
    // Explicit caller filtering also avoids an admin's read privileges exposing
    // somebody else's report in the ordinary Marketplace form.
    const result = await supabase.from('reports').select(REPORT_FIELDS)
      .eq('listing_id', listingId).eq('reporter_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (result.error) return { report: null, error: mapModerationError(result.error, { reporting: true }) }
    const row = result.data
    if (!row) return { report: null, error: null }
    if (!isUuid(row.id) || row.listing_id !== listingId || row.reporter_id !== user.id || !['open', 'resolved'].includes(row.status)) {
      return { report: null, error: moderationFailure('Your report status could not be verified. Refresh and try again.') }
    }
    return { report: row, error: null }
  } catch {
    return { report: null, error: mapModerationError(null, { reporting: true }) }
  }
}

export async function createListingReport(listingId, reason) {
  if (!isUuid(listingId)) return { reportId: null, error: moderationFailure('Choose a valid listing.', 'invalid_listing') }
  const normalized = typeof reason === 'string' ? reason.trim() : ''
  if (!normalized || Array.from(normalized).length > 1000 || unsupportedControls.test(normalized)) {
    return { reportId: null, error: moderationFailure('Enter a report reason of 1–1000 characters without unsupported control characters.', 'invalid_report') }
  }
  const { error } = await verifiedModerationUser()
  if (error) return { reportId: null, error }
  try {
    // Reporter, initial status and timestamps come exclusively from PostgreSQL.
    // The RPC serializes duplicate attempts, including across tabs/devices.
    const result = await supabase.rpc('create_listing_report', { p_listing_id: listingId, p_reason: normalized })
    if (result.error) return { reportId: null, error: mapModerationError(result.error, { mutation: true, reporting: true }) }
    if (!isUuid(result.data)) return { reportId: null, error: mapModerationError(null, { mutation: true, reporting: true }) }
    return { reportId: result.data, error: null }
  } catch {
    return { reportId: null, error: mapModerationError(null, { mutation: true, reporting: true }) }
  }
}
