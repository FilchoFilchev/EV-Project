import { supabase, configurationError } from '../config/supabaseClient.js'
import { getSession, getCurrentUser } from '../services/authService.js'

const loginUrl = '/login.html'

function showGuardMessage(message) {
  const pageContent = document.querySelector('#page-content')
  if (!pageContent) {
    return
  }

  pageContent.innerHTML = `
    <div class="container py-5">
      <div class="alert alert-warning" role="alert">
        ${message}
      </div>
    </div>
  `
}

function redirectToLogin(returnUrl = window.location.pathname) {
  const params = new URLSearchParams({ redirect: returnUrl })
  window.location.replace(`${loginUrl}?${params}`)
}

export async function requireAuthentication(options = {}) {
  if (!supabase) {
    showGuardMessage(
      options.configurationError ?? configurationError ??
        'Supabase is not configured. This protected page cannot be accessed until configuration is available.'
    )
    return null
  }

  const { session, error } = await getSession()

  if (error) {
    showGuardMessage('Unable to verify your session with Supabase Auth. Please try again.')
    return null
  }

  if (!session) {
    redirectToLogin()
    return null
  }

  const { user, error: userError } = await getCurrentUser()

  if (userError || !user) {
    showGuardMessage('Unable to verify your authenticated session. Please sign in again.')
    return null
  }

  return user
}

export async function requireAdmin(options = {}) {
  const user = await requireAuthentication(options)
  if (!user) {
    return null
  }

  if (typeof options.adminCheck !== 'function') {
    showGuardMessage(
      'Admin permissions have not been verified yet. Database role verification is required before accessing this page.'
    )
    return null
  }

  let isAdmin = false
  try {
    isAdmin = await options.adminCheck(user)
  } catch {
    showGuardMessage('Unable to verify admin permissions. Please try again.')
    return null
  }

  if (!isAdmin) {
    showGuardMessage('You do not have permission to access the Admin area.')
    return null
  }

  return user
}
