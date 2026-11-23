import { listMyLicenses } from '../services/licenseService.js'
import { formatEuroCents } from '../utils/marketplaceFilters.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Date unavailable'
}

export function initAcquiredLicenses() {
  const status = document.querySelector('#licenses-status')
  const error = document.querySelector('#licenses-error')
  const empty = document.querySelector('#licenses-empty')
  const list = document.querySelector('#licenses-list')
  const refresh = document.querySelector('#licenses-refresh')
  let loading = false

  async function load() {
    if (loading) return
    loading = true
    refresh.disabled = true
    list.setAttribute('aria-busy', 'true')
    list.replaceChildren()
    empty.hidden = true
    error.hidden = true
    status.textContent = 'Loading your acquired licenses…'
    try {
      const result = await listMyLicenses()
      if (result.error) {
        status.textContent = ''
        error.textContent = result.error.message
        error.hidden = false
        return
      }
      const licenses = result.licenses ?? []
      for (const license of licenses) {
        const column = element('div', 'col-12 col-md-6')
        const card = element('article', 'card h-100')
        const body = element('div', 'card-body text-break')
        const title = license.listing?.version?.recording?.title || 'Licensed voice recording'
        body.append(
          element('h2', 'h5', title),
          element('p', 'fw-semibold', license.license_type === 'buy' ? 'Demo Buy · perpetual nonexclusive license' : 'Demo Rent · 30-day nonexclusive license'),
          element('p', 'small text-secondary', `Demo price snapshot: ${formatEuroCents(license.price_cents)}. No real money was charged.`),
          element('p', 'small text-secondary', `Issued: ${formatTimestamp(license.created_at)}`),
          element('p', 'small', license.license_type === 'buy' ? 'No expiry.' : `Expires: ${formatTimestamp(license.expires_at)}. Rental validity is checked using database time.`),
          element('p', 'small text-secondary mb-0', `License ID: ${license.id}`),
        )
        if (license.listing?.status === 'archived') {
          body.append(element('p', 'small mt-2 mb-0', 'Listing archived. Your issued license is preserved.'))
        }
        card.append(body)
        column.append(card)
        list.append(column)
      }
      empty.hidden = licenses.length > 0
      status.textContent = licenses.length ? `${licenses.length} acquired license${licenses.length === 1 ? '' : 's'}.` : ''
    } catch {
      status.textContent = ''
      error.textContent = 'Your licenses could not be loaded. Check your connection and try again.'
      error.hidden = false
    } finally {
      loading = false
      refresh.disabled = false
      list.setAttribute('aria-busy', 'false')
    }
  }

  refresh.addEventListener('click', load)
  return { load }
}
