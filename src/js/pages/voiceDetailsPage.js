import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAuthentication } from '../utils/routeGuard.js'

renderNavbar('marketplace')
renderFooter()
initPageTransitions()
requireAuthentication()
