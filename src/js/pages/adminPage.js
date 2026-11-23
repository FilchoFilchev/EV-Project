import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAdmin } from '../utils/routeGuard.js'
import { initAdminPanel } from '../components/adminPanel.js'

renderNavbar('admin')
renderFooter()
initPageTransitions()

async function initializeAdmin() {
  const user = await requireAdmin()
  if (user) await initAdminPanel({ userId: user.id }).load()
}

initializeAdmin()
