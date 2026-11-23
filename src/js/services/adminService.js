import { supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'
import { mapModerationError, moderationFailure, verifiedModerationUser } from './moderationClient.js'

const PAGE_SIZE = 200

async function listAdminRows(rpc, key) {
  const { error } = await verifiedModerationUser()
  if (error) return { [key]: null, error }
  const rows = []
  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // Each page rechecks the database role inside the RPC. There is no
      // browser-supplied role or generic table-reading definer function.
      const result = await supabase.rpc(rpc, { p_offset: offset, p_limit: PAGE_SIZE })
      if (result.error) return { [key]: null, error: mapModerationError(result.error) }
      if (!Array.isArray(result.data)) return { [key]: null, error: moderationFailure('The moderation response was incomplete. Refresh and try again.') }
      rows.push(...result.data)
      if (result.data.length < PAGE_SIZE) return { [key]: rows, error: null }
    }
  } catch {
    return { [key]: null, error: mapModerationError(null) }
  }
}

export function listAdminUsers() { return listAdminRows('admin_list_users', 'users') }
export function listAdminListings() { return listAdminRows('admin_list_listings', 'listings') }
export function listAdminReports() { return listAdminRows('admin_list_reports', 'reports') }

async function adminAction(rpc, args, valid) {
  if (!valid) return { error: moderationFailure('Choose a valid item and an available moderation action.', 'invalid_input') }
  const { error } = await verifiedModerationUser()
  if (error) return { error }
  try {
    const result = await supabase.rpc(rpc, args)
    if (result.error) return { error: mapModerationError(result.error, { mutation: true }) }
    if (!isUuid(result.data)) return { error: mapModerationError(null, { mutation: true }) }
    return { id: result.data, error: null }
  } catch {
    return { error: mapModerationError(null, { mutation: true }) }
  }
}

export function adminResolveReport(reportId) {
  return adminAction('admin_resolve_report', { p_report_id: reportId }, isUuid(reportId))
}

export function adminModerateListing(listingId, status) {
  return adminAction('admin_moderate_listing', { p_listing_id: listingId, p_status: status },
    isUuid(listingId) && ['published', 'archived'].includes(status))
}

export function adminSetPremium(userId, plan) {
  return adminAction('admin_set_premium', { p_target_user: userId, p_plan: plan },
    isUuid(userId) && ['free', 'premium'].includes(plan))
}
