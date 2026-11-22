import { configurationError, supabase } from '../config/supabaseClient.js'

// Eligibility is evaluated against database time, never a browser plan flag or clock.
export async function getPremiumEligibility() {
  if (!supabase) return { premium: false, error: configurationError }

  try {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user?.id) {
      return { premium: false, error: 'Sign in to verify your Premium access.' }
    }

    const { data, error } = await supabase.rpc('has_active_premium')
    if (error || typeof data !== 'boolean') {
      return { premium: false, error: 'Premium access could not be verified. Try checking access again.' }
    }
    return { premium: data, error: null }
  } catch {
    return { premium: false, error: 'Premium access could not be verified. Check your connection and try again.' }
  }
}
