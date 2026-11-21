import { supabase, configurationError } from '../config/supabaseClient.js'

export async function getSession() {
  if (!supabase) {
    return { session: null, user: null, error: configurationError }
  }

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      return { session: null, user: null, error: error.message }
    }

    const session = data?.session ?? null
    return { session, user: session?.user ?? null, error: null }
  } catch {
    return {
      session: null,
      user: null,
      error: 'Supabase Auth is unavailable. Please try again.',
    }
  }
}

export async function getCurrentUser() {
  if (!supabase) {
    return { user: null, error: configurationError }
  }

  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      return { user: null, error: error.message }
    }

    return { user: data?.user ?? null, error: null }
  } catch {
    return { user: null, error: 'Supabase Auth is unavailable. Please try again.' }
  }
}

export async function isAuthenticated() {
  const { session, error } = await getSession()
  return { authenticated: Boolean(session) && !error, error }
}

export function subscribeToAuthState(callback) {
  if (!supabase) {
    callback({ event: 'CONFIGURATION_ERROR', session: null, user: null })
    return () => {}
  }

  try {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      callback({
        event,
        session,
        user: session?.user ?? null,
      })
    })

    return data?.subscription?.unsubscribe ?? (() => {})
  } catch {
    callback({ event: 'AUTH_UNAVAILABLE', session: null, user: null })
    return () => {}
  }
}

export async function signOut() {
  if (!supabase) {
    return { error: configurationError }
  }

  try {
    const { error } = await supabase.auth.signOut()
    return { error: error?.message ?? null }
  } catch {
    return { error: 'Supabase Auth is unavailable. Please try again.' }
  }
}
