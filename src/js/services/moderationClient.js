import { configurationError, supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'

export function moderationFailure(message, code = 'moderation_error', outcomeUnknown = false) {
  return { message, code, outcomeUnknown }
}

export async function verifiedModerationUser() {
  if (!supabase) return { user: null, error: moderationFailure(configurationError || 'Supabase is not configured.', 'configuration') }
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !isUuid(data?.user?.id)) {
      return { user: null, error: moderationFailure('Sign in to report a listing or use moderation tools.', 'authentication_required') }
    }
    return { user: data.user, error: null }
  } catch {
    return { user: null, error: moderationFailure('Your sign-in could not be verified. Please try again.', 'authentication_error') }
  }
}

export function mapModerationError(error, { mutation = false, reporting = false } = {}) {
  const status = Number(error?.status ?? error?.statusCode)
  if (error?.code === '42501' || status === 401 || status === 403) {
    return moderationFailure(reporting ? 'Sign in to report an available Marketplace listing.' : 'You do not have permission to use these moderation tools.', 'access_denied')
  }
  if (error?.code === '23505' && reporting) {
    return moderationFailure('You have already reported this listing. Your existing report is available to the administrators.', 'duplicate_report')
  }
  if (error?.code === 'P0002') return moderationFailure('This listing, report, or user is no longer available. Refresh and try again.', 'not_found')
  if (['22023', '23514', '22P02'].includes(error?.code)) {
    return moderationFailure(reporting ? 'Enter a report reason of 1–1000 characters for an available published listing.' : 'This change is not allowed for the current item. Refresh and choose an available action.', 'invalid_input')
  }
  if (['PGRST202', 'PGRST204', '42703', '42883', '42P01'].includes(error?.code)) {
    return moderationFailure('Reports and moderation require the Prompt 17 database migration. Ask the project owner to review and apply it to echovault-dev.', 'setup_required')
  }
  const definitive = /^[0-9A-Z]{5}$/.test(error?.code ?? '') || (Number.isInteger(status) && status >= 400 && status < 500)
  if (mutation && !definitive) {
    return moderationFailure('The result could not be confirmed. Refresh to check the current status before trying again.', 'outcome_unknown', true)
  }
  return moderationFailure(mutation ? 'The change could not be saved. Please try again.' : 'The data could not be loaded. Check your connection and try again.')
}
