import { getDashboardSummary } from '../services/dashboardService.js'
import { getPremiumEligibility } from '../services/subscriptionService.js'
import { subscribeToAuthState } from '../services/authService.js'

export function initDashboardOverview({ userId } = {}) {
  const overview = document.querySelector('#dashboard-overview')
  const status = document.querySelector('#dashboard-status')
  const error = document.querySelector('#dashboard-error')
  const plan = document.querySelector('#dashboard-plan')
  const recent = document.querySelector('#dashboard-recent')
  const empty = document.querySelector('#dashboard-empty')
  const refresh = document.querySelector('#dashboard-refresh')
  const counts = Object.fromEntries(['recordings', 'edited', 'listings', 'licenses']
    .map((name) => [name, document.querySelector(`#dashboard-${name}-count`)]))
  let loading = false
  let blocked = false
  let disposed = false
  let generation = 0

  function clear() {
    Object.values(counts).forEach((node) => { node.textContent = '—' })
    recent.replaceChildren()
    empty.hidden = true
    error.hidden = true
    plan.textContent = 'Plan unavailable.'
  }

  async function load() {
    if (loading || blocked || disposed) return
    loading = true
    const request = ++generation
    clear()
    refresh.disabled = true
    overview.setAttribute('aria-busy', 'true')
    status.textContent = 'Loading your overview…'
    plan.textContent = 'Checking your plan…'
    try {
      const [result, eligibility] = await Promise.all([getDashboardSummary(), getPremiumEligibility()])
      if (disposed || request !== generation) return
      plan.textContent = eligibility.error
        ? 'Your plan could not be verified. Refresh to try again.'
        : `Current plan: ${eligibility.premium ? 'Premium' : 'Free'}`
      if (result.error) {
        error.textContent = result.error.message
        error.hidden = false
        status.textContent = ''
        return
      }
      for (const [key, node] of Object.entries(counts)) node.textContent = String(result.summary[key])
      for (const recording of result.summary.recent) {
        const item = document.createElement('li')
        item.className = 'list-group-item'
        const title = document.createElement('p')
        title.className = 'fw-semibold text-break mb-1'
        title.textContent = recording.title
        const details = document.createElement('p')
        details.className = 'small text-secondary text-break mb-0'
        const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(recording.created_at))
        details.textContent = `${recording.category} · ${date}`
        item.append(title, details)
        recent.append(item)
      }
      empty.hidden = result.summary.recent.length > 0
      status.textContent = 'Your overview is up to date.'
    } catch {
      if (!disposed && request === generation) {
        clear()
        error.textContent = 'Your overview could not be loaded. Check your connection and refresh.'
        error.hidden = false
        status.textContent = ''
      }
    } finally {
      if (!disposed && request === generation) {
        loading = false
        overview.setAttribute('aria-busy', 'false')
        refresh.disabled = blocked
      }
    }
  }

  refresh.addEventListener('click', load)
  const unsubscribe = subscribeToAuthState(({ user, event }) => {
    if (event !== 'SIGNED_OUT' && (!user || user.id === userId)) return
    generation++
    blocked = true
    clear()
    overview.setAttribute('aria-busy', 'false')
    refresh.disabled = true
    status.textContent = 'Your account changed. Reload this page to verify access.'
  })
  function dispose() {
    disposed = true
    generation++
    clear()
    unsubscribe()
  }
  window.addEventListener('pagehide', dispose)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
  return { load, dispose }
}
