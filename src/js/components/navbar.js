import {
  getCurrentUser,
  signOut,
  subscribeToAuthState,
} from '../services/authService.js'

const links = [
  ['dashboard', 'Dashboard', '/dashboard.html'],
  ['studio', 'Studio', '/studio.html'],
  ['marketplace', 'Marketplace', '/marketplace.html'],
  ['my-library', 'My Library', '/my-library.html'],
]

function renderPageLinks(activePage) {
  return links
    .map(
      ([page, label, href]) => `
        <li class="nav-item">
          <a class="nav-link${activePage === page ? ' active' : ''}"${
            activePage === page ? ' aria-current="page"' : ''
          } href="${href}">${label}</a>
        </li>`
    )
    .join('')
}

function renderAuthActions(container, user, error = null) {
  container.innerHTML = user
    ? '<button class="btn btn-outline-primary btn-sm" type="button" data-action="logout">Logout</button>'
    : '<a class="btn btn-outline-primary btn-sm" href="/login.html">Login</a><a class="btn btn-primary btn-sm" href="/register.html">Register</a>'

  if (error) {
    const status = document.createElement('span')
    status.className = 'navbar-auth-message small text-danger'
    status.setAttribute('role', 'status')
    status.textContent = error
    container.append(status)
  }
}

function renderNavbarState(container, pageLinks, activePage, user, error) {
  pageLinks.innerHTML = user ? renderPageLinks(activePage) : ''
  renderAuthActions(container, user, error)
}

function initializeNavbarAuth(activePage) {
  const container = document.querySelector('#navbar-auth-actions')
  const pageLinks = document.querySelector('#navbar-page-links')
  let currentUser = null
  let authStateVersion = 0
  let signingOut = false

  container.addEventListener('click', async (event) => {
    const logoutButton = event.target.closest('[data-action="logout"]')
    if (!logoutButton || signingOut) {
      return
    }

    signingOut = true
    logoutButton.disabled = true
    logoutButton.textContent = 'Signing out...'

    const { error } = await signOut()
    if (error) {
      signingOut = false
      renderAuthActions(container, currentUser, error.message)
      return
    }

    window.location.replace('/login.html')
  })

  subscribeToAuthState(({ event, session }) => {
    authStateVersion += 1
    currentUser = session?.user ?? null
    renderNavbarState(
      container,
      pageLinks,
      activePage,
      currentUser,
      event === 'CONFIGURATION_ERROR' || event === 'AUTH_UNAVAILABLE'
        ? 'Authentication is unavailable. Please try again.'
        : null
    )
  })

  const initialAuthStateVersion = authStateVersion
  getCurrentUser().then(({ user, error }) => {
    if (authStateVersion !== initialAuthStateVersion) {
      return
    }

    currentUser = user
    renderNavbarState(
      container,
      pageLinks,
      activePage,
      currentUser,
      error ? 'Unable to verify sign-in status. Please try again.' : null
    )
  })
}

export function renderNavbar(activePage) {
  document.querySelector('#navbar').innerHTML = `
    <header class="site-header border-bottom sticky-top">
      <nav class="container navbar navbar-expand-lg" aria-label="Primary navigation">
        <a class="navbar-brand fw-bold" href="/" aria-label="EchoVault home"><span>E</span>cho<span>V</span>ault</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#main-navigation"
          aria-controls="main-navigation" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="main-navigation">
          <ul id="navbar-page-links" class="navbar-nav mx-lg-auto"></ul>
          <div id="navbar-auth-actions" class="navbar-auth-actions d-flex gap-2 mt-3 mt-lg-0" aria-live="polite">
            <span class="small text-secondary" role="status">Checking sign-in...</span>
          </div>
        </div>
      </nav>
    </header>
  `

  initializeNavbarAuth(activePage)
}
