import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAuthentication } from '../utils/routeGuard.js'
import { initDashboardOverview } from '../components/dashboardOverview.js'

renderNavbar('dashboard')
renderFooter()
initPageTransitions()
async function initializeDashboard() {
  const user = await requireAuthentication()
  if (user) await initDashboardOverview({ userId: user.id }).load()
}

initializeDashboard()
