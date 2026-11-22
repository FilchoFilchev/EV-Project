import { supabase, configurationError } from '../config/supabaseClient.js'

const protectedPages = new Set([
  '/dashboard.html',
  '/studio.html',
  '/marketplace.html',
  '/voice-details.html',
  '/my-library.html',
  '/admin.html',
])

function authFailure(message, code = 'auth_error', status = null) {
  return { code, message, status }
}

function mapAuthError(error, operation) {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : ''
  const status =
    error?.status == null || !Number.isFinite(Number(error.status))
      ? null
      : Number(error.status)

  switch (code) {
    case 'over_email_send_rate_limit':
      return authFailure(
        "We've reached our email verification limit. Please try again later or sign in if you already have an account.",
        code,
        status
      )
    case 'over_request_rate_limit':
      return authFailure(
        'Too many requests have been made. Please try again later.',
        code,
        status
      )
    case 'email_address_invalid':
      return authFailure(
        'Please enter a valid email address and check for typing mistakes.',
        code,
        status
      )
    case 'email_address_not_authorized':
      return authFailure(
        'The development email service can send verification messages only to authorized project-team addresses. Please use an authorized test address or contact the project administrator.',
        code,
        status
      )
    case 'email_exists':
    case 'user_already_exists':
      if (operation === 'signUp') {
        return authFailure(
          'We could not complete registration. If you already have an account, sign in instead; otherwise, check your details and try again.',
          code,
          status
        )
      }
      break
    case 'weak_password':
      return authFailure(
        'Choose a password with at least 8 characters that meets the project password requirements.',
        code,
        status
      )
    case 'email_not_confirmed':
      return authFailure(
        'Please confirm your email using the link in your inbox, then try signing in again.',
        code,
        status
      )
    case 'invalid_credentials':
      if (operation === 'signIn') {
        return authFailure(
          'Email or password is incorrect. If you just registered, confirm your email first.',
          code,
          status
        )
      }
      break
  }

  if (status === 429) {
    return authFailure(
      'The authentication service is temporarily limiting this request. Please wait and try again.',
      'auth_request_limited',
      status
    )
  }

  if (status !== null && status >= 500) {
    return authFailure(
      'The authentication service is temporarily unavailable. Please try again later.',
      'auth_service_unavailable',
      status
    )
  }

  if (
    error?.name === 'AuthRetryableFetchError' ||
    error instanceof TypeError ||
    status === 0
  ) {
    return authFailure(
      'We could not reach the authentication service. Check your connection and try again.',
      'network_error',
      status
    )
  }

  return authFailure(
    operation === 'signUp'
      ? 'Unable to create your account right now. Please try again.'
      : operation === 'signIn'
        ? 'Unable to sign in right now. Please try again.'
        : 'Supabase Auth is unavailable. Please try again.',
    code || 'auth_error',
    status
  )
}

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
  const { session, error: sessionError } = await getSession()
  if (sessionError || !session) {
    return { user: null, error: sessionError }
  }

  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      return { user: null, error: error.message }
    }

    return { user: data?.user ?? null, error: null }
  } catch {
    return { user: null, error: 'Unable to verify your session. Please try again.' }
  }
}

export async function isAuthenticated() {
  const { user, error } = await getCurrentUser()
  return { authenticated: Boolean(user) && !error, error }
}

export async function signUp({ displayName: validatedDisplayName, email, password }) {
  if (!supabase) {
    return { user: null, session: null, error: authFailure(configurationError, 'configuration') }
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: validatedDisplayName },
      },
    })

    if (error) {
      return { user: null, session: null, error: mapAuthError(error, 'signUp') }
    }

    return {
      user: data?.user ?? null,
      session: data?.session ?? null,
      error: null,
    }
  } catch (error) {
    return {
      user: null,
      session: null,
      error: mapAuthError(error, 'signUp'),
    }
  }
}

export async function signInWithPassword({ email, password }) {
  if (!supabase) {
    return { user: null, session: null, error: authFailure(configurationError, 'configuration') }
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return { user: null, session: null, error: mapAuthError(error, 'signIn') }
    }

    return {
      user: data?.user ?? null,
      session: data?.session ?? null,
      error: null,
    }
  } catch (error) {
    return {
      user: null,
      session: null,
      error: mapAuthError(error, 'signIn'),
    }
  }
}

export async function getCurrentUserRole() {
  if (!supabase) {
    return { role: null, error: configurationError }
  }

  const { user, error: userError } = await getCurrentUser()
  if (userError || !user) {
    return {
      role: null,
      error: userError ?? 'Sign in is required to verify permissions.',
    }
  }

  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      return { role: null, error: 'Unable to verify your database role.' }
    }

    return { role: data?.role ?? null, error: null }
  } catch {
    return { role: null, error: 'Unable to verify your database role.' }
  }
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
    return { error: authFailure(configurationError, 'configuration') }
  }

  try {
    const { error } = await supabase.auth.signOut()
    return { error: error ? mapAuthError(error, 'signOut') : null }
  } catch (error) {
    return { error: mapAuthError(error, 'signOut') }
  }
}

export function getSafeInternalRedirect(destination) {
  if (typeof destination !== 'string') {
    return '/dashboard.html'
  }

  const value = destination.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard.html'
  }

  try {
    const url = new URL(value, window.location.origin)
    if (
      url.origin !== window.location.origin ||
      url.username ||
      url.password ||
      !protectedPages.has(url.pathname)
    ) {
      return '/dashboard.html'
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/dashboard.html'
  }
}
