export function renderNavbar(activePage) {
  const links = [
    ['dashboard', 'Dashboard', '/dashboard.html'],
    ['studio', 'Studio', '/studio.html'],
    ['marketplace', 'Marketplace', '/marketplace.html'],
    ['my-library', 'My Library', '/my-library.html'],
  ]

  const navLinks = links.map(([page, label, href]) =>
    `<li class="nav-item">
      <a class="nav-link${activePage === page ? ' active' : ''}"${activePage === page ? ' aria-current="page"' : ''} href="${href}">${label}</a>
    </li>`
  ).join('')

  document.querySelector('#navbar').innerHTML = `
    <header class="site-header border-bottom sticky-top">
      <nav class="container navbar navbar-expand-lg" aria-label="Primary navigation">
        <a class="navbar-brand fw-bold" href="/" aria-label="EchoVault home"><span>E</span>cho<span>V</span>ault</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#main-navigation"
          aria-controls="main-navigation" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="main-navigation">
          <ul class="navbar-nav mx-lg-auto">${navLinks}</ul>
          <div class="d-flex gap-2 mt-3 mt-lg-0">
            <a class="btn btn-outline-primary btn-sm" href="/login.html">Login</a>
            <a class="btn btn-primary btn-sm" href="/register.html">Register</a>
          </div>
        </div>
      </nav>
    </header>
  `
}
