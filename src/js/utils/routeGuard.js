import {
  getCurrentUser,
  getCurrentUserRole,
  subscribeToAuthState,
} from '../services/authService.js'

const loginUrl = '/login.html'
let authWasSignedOut = false

function setAuthPageState(state) {
  const app = document.querySelector('#app')
  if (app) {
    app.dataset.authState = state
  }
}

function showGuardMessage(message) {
  const pageContent = document.querySelector('#page-content')
  if (pageContent) {
    const container = document.createElement('div')
    container.className = 'container py-5'

    const alert = document.createElement('div')
    alert.className = 'alert alert-warning'
    alert.setAttribute('role', 'alert')
    alert.textContent = message
    container.append(alert)
    pageContent.replaceChildren(container)
  }

  setAuthPageState('ready')
}

function redirectToLogin() {
  const returnDestination =
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  const params = new URLSearchParams({ redirect: returnDestination })
  window.location.replace(`${loginUrl}?${params}`)
}

export async function requireAuthentication({ deferReveal = false } = {}) {
  authWasSignedOut = false
  setAuthPageState('pending')

  subscribeToAuthState(({ event }) => {
    if (event === 'SIGNED_OUT') {
      authWasSignedOut = true
      setAuthPageState('pending')
      window.location.replace(loginUrl)
    }
  })

  const { user, error } = await getCurrentUser()
  if (authWasSignedOut) {
    return null
  }

  if (error) {
    showGuardMessage('Unable to verify your session with Supabase Auth. Please try again.')
    return null
  }

  if (!user) {
    redirectToLogin()
    return null
  }

  if (!deferReveal) {
    setAuthPageState('ready')
  }

  return user
}

export async function requireAdmin() {
  const user = await requireAuthentication({ deferReveal: true })
  if (!user) {
    return null
  }

  const { role, error } = await getCurrentUserRole()
  if (authWasSignedOut) {
    return null
  }

  if (error) {
    showGuardMessage('Unable to verify your database role. Please try again.')
    return null
  }

  if (role !== 'admin') {
    showGuardMessage('You do not have permission to access the Admin area.')
    return null
  }

  setAuthPageState('ready')
  return user
}
