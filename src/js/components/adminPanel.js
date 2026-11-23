import {
  listAdminUsers, listAdminListings, listAdminReports,
  adminSetPremium, adminModerateListing, adminResolveReport,
} from '../services/adminService.js'
import { subscribeToAuthState } from '../services/authService.js'

const tabs = ['reports', 'listings', 'users']
const labels = { reports: 'Reports', listings: 'Listings', users: 'Users' }
const loaders = { reports: listAdminReports, listings: listAdminListings, users: listAdminUsers }

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function timestamp(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Unavailable'
}

export function initAdminPanel({ userId } = {}) {
  const panel = document.querySelector('#admin-panel')
  const heading = document.querySelector('#admin-heading')
  const status = document.querySelector('#admin-status')
  const error = document.querySelector('#admin-error')
  const empty = document.querySelector('#admin-empty')
  const list = document.querySelector('#admin-list')
  const refresh = document.querySelector('#admin-refresh')
  const buttons = tabs.map((tab) => document.querySelector(`#admin-tab-${tab}`))
  const actions = []
  let active = 'reports'
  let loading = false
  let pending = false
  let blocked = false
  let disposed = false
  let generation = 0

  function clear() {
    generation++
    loading = false
    list.replaceChildren()
    actions.length = 0
    list.setAttribute('aria-busy', 'false')
    empty.hidden = true
    error.hidden = true
  }

  function setDisabled(value) {
    refresh.disabled = value
    for (const button of actions) button.disabled = value
  }

  function showError(failure) {
    error.textContent = failure?.message || 'This request could not be completed. Please try again.'
    error.hidden = false
    if (['access_denied', 'authentication_required'].includes(failure?.code)) {
      list.replaceChildren()
      empty.hidden = true
      blocked = true
      setDisabled(true)
      buttons.forEach((tab) => { tab.disabled = true })
    }
  }

  async function runAction(button, operation, success) {
    if (disposed || blocked || pending || loading) return
    pending = true
    const request = generation
    const originalLabel = button.textContent
    setDisabled(true)
    buttons.forEach((tab) => { tab.disabled = true })
    button.textContent = 'Saving…'
    status.textContent = 'Saving admin action…'
    error.hidden = true
    try {
      const result = await operation()
      if (disposed || request !== generation) return
      if (result.error) {
        status.textContent = ''
        showError(result.error)
      } else {
        pending = false
        await load(active, success)
      }
    } catch {
      if (!disposed && request === generation) {
        status.textContent = ''
        showError({ message: 'The admin action could not be completed. Refresh to check its status before trying again.' })
      }
    } finally {
      pending = false
      button.textContent = originalLabel
      if (!disposed) {
        setDisabled(blocked || loading)
        buttons.forEach((tab) => { tab.disabled = blocked })
      }
    }
  }

  function addAction(body, label, description, operation, success, danger = false) {
    const button = element('button', danger ? 'btn btn-outline-danger' : 'btn btn-outline-primary', label)
    button.type = 'button'
    button.setAttribute('aria-label', `${label}: ${description}`)
    button.addEventListener('click', () => runAction(button, operation, success))
    body.append(button)
    actions.push(button)
  }

  function renderReport(body, report) {
    body.append(
      element('h3', 'h5 text-break', report.listing_title || 'Reported listing'),
      element('p', 'fw-semibold', `Status: ${report.status}`),
      element('p', 'text-break', report.reason),
      element('p', 'small text-secondary text-break', `Listing ID: ${report.listing_id}`),
      element('p', 'small text-secondary text-break', `Reporter ID: ${report.reporter_id}`),
      element('p', 'small text-secondary', `Submitted: ${timestamp(report.created_at)}`),
    )
    if (report.status === 'open') {
      addAction(body, 'Resolve report', report.listing_title || report.listing_id,
        () => adminResolveReport(report.id), 'Report resolved. Resolution time was recorded.')
    } else {
      body.append(element('p', 'small text-secondary mb-0', `Resolved: ${timestamp(report.resolved_at)}`))
    }
  }

  function renderListing(body, listing) {
    body.append(
      element('h3', 'h5 text-break', listing.title || 'Voice listing'),
      element('p', 'fw-semibold', `Status: ${listing.status}`),
      element('p', 'small text-secondary text-break', `Listing ID: ${listing.id}`),
      element('p', 'small text-secondary text-break', `Owner ID: ${listing.owner_id}`),
    )
    if (listing.status === 'published') {
      addAction(body, 'Archive listing', listing.title || listing.id,
        () => adminModerateListing(listing.id, 'archived'), 'Listing archived. Existing licenses are preserved.', true)
    } else if (listing.status === 'archived') {
      addAction(body, 'Restore listing', listing.title || listing.id,
        () => adminModerateListing(listing.id, 'published'), 'Listing restored to the Marketplace.')
    } else {
      body.append(element('p', 'small text-secondary mb-0', 'Draft listing. Only its owner can publish it.'))
    }
  }

  function renderUser(body, user) {
    const name = user.display_name || 'EchoVault user'
    body.append(
      element('h3', 'h5 text-break', name),
      element('p', 'small text-secondary text-break', `User ID: ${user.id}`),
      element('p', 'fw-semibold', `Demo plan: ${user.plan || 'free'}`),
    )
    if (user.plan === 'premium') body.append(element('p', 'small text-secondary', `Premium expires: ${timestamp(user.expires_at)}`))
    const controls = element('div', 'd-flex flex-wrap gap-2')
    addAction(controls, 'Set demo Premium (30 days)', name,
      () => adminSetPremium(user.id, 'premium'), 'Demo Premium assigned for 30 days using database time.')
    addAction(controls, 'Set Free', name,
      () => adminSetPremium(user.id, 'free'), 'Demo plan changed to Free.')
    body.append(controls)
  }

  async function load(tab = active, success = '') {
    if (disposed || blocked || pending || !tabs.includes(tab) || (loading && tab === active)) return
    clear()
    active = tab
    const request = generation
    buttons.forEach((button, index) => {
      const selected = tabs[index] === active
      button.className = `nav-link${selected ? ' active' : ''}`
      button.setAttribute('aria-selected', String(selected))
      button.tabIndex = selected ? 0 : -1
    })
    panel.setAttribute('aria-labelledby', `admin-tab-${active}`)
    heading.textContent = labels[active]
    refresh.textContent = `Refresh ${active}`
    loading = true
    refresh.disabled = true
    list.setAttribute('aria-busy', 'true')
    status.textContent = `Loading ${active}…`
    try {
      const result = await loaders[active]()
      if (disposed || request !== generation) return
      if (result.error) {
        status.textContent = ''
        showError(result.error)
        return
      }
      const rows = result[active] ?? []
      for (const row of rows) {
        const column = element('div', 'col-12 col-lg-6')
        const card = element('article', 'card h-100')
        const body = element('div', 'card-body text-break')
        if (active === 'reports') renderReport(body, row)
        else if (active === 'listings') renderListing(body, row)
        else renderUser(body, row)
        card.append(body)
        column.append(card)
        list.append(column)
      }
      empty.textContent = `No ${active} to display.`
      empty.hidden = rows.length > 0
      status.textContent = success || (rows.length ? `${rows.length} ${active} loaded.` : '')
    } catch {
      if (!disposed && request === generation) {
        status.textContent = ''
        showError({ message: `The ${active} could not be loaded. Check your connection and refresh.` })
      }
    } finally {
      if (!disposed && request === generation) {
        loading = false
        setDisabled(blocked)
        list.setAttribute('aria-busy', 'false')
      }
    }
  }

  for (const [index, button] of buttons.entries()) {
    button.addEventListener('click', () => load(tabs[index]))
    button.addEventListener('keydown', (event) => {
      let next
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault()
      if (pending || blocked) return
      buttons[next].focus()
      void load(tabs[next])
    })
  }
  refresh.addEventListener('click', () => load())
  const unsubscribe = subscribeToAuthState(({ user, event }) => {
    if (event !== 'SIGNED_OUT' && (!user || !userId || user.id === userId)) return
    clear()
    blocked = true
    setDisabled(true)
    buttons.forEach((tab) => { tab.disabled = true })
    status.textContent = 'Your account changed. Reload this page to verify admin access.'
  })
  function dispose() {
    disposed = true
    clear()
    unsubscribe()
  }
  window.addEventListener('pagehide', dispose)
  window.addEventListener('pageshow', (event) => {
    // A restored page must run the role guard again before requesting admin data.
    if (event.persisted) window.location.reload()
  })
  return { load, dispose }
}
