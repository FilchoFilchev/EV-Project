import { demoCheckout, getMyLicense } from '../services/licenseService.js'
import { formatEuroCents, formatMarketplaceDate } from '../utils/marketplaceFilters.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createDemoCheckout(listing, { userId } = {}) {
  const root = element('section', 'mt-4')
  root.setAttribute('aria-label', 'Demo Checkout')
  const actions = element('div', 'd-flex flex-wrap gap-2')
  const notice = element('p', 'small text-secondary mt-3', 'Demo Checkout only. No real money will be charged.')
  const status = element('p', 'small text-break mb-0')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const error = element('div', 'alert alert-danger mt-3')
  error.setAttribute('role', 'alert')
  error.hidden = true
  const form = element('form', 'border rounded p-3 mt-3')
  form.hidden = true
  const summary = element('p', 'fw-semibold')
  const pricing = element('p', 'small text-secondary', 'The server checks the current offer and determines the final demo price.')
  const check = element('label', 'd-flex align-items-start gap-2 mb-3')
  const confirmation = element('input', 'form-check-input flex-shrink-0')
  confirmation.type = 'checkbox'
  confirmation.required = true
  check.append(confirmation, element('span', '', 'I understand this is Demo Checkout. No real money will be charged.'))
  const controls = element('div', 'd-flex flex-wrap gap-2')
  const confirm = element('button', 'btn btn-primary', 'Confirm Demo Checkout')
  confirm.type = 'submit'
  const cancel = element('button', 'btn btn-outline-secondary', 'Cancel')
  cancel.type = 'button'
  controls.append(confirm, cancel)
  form.append(summary, pricing, check, controls)
  const libraryLink = element('a', 'btn btn-outline-primary mt-3', 'View acquired licenses')
  libraryLink.href = '/my-library.html#acquired-licenses'
  libraryLink.hidden = true
  let selectedType = null
  let selectedButton = null
  let busy = false
  let stopped = !userId || userId === listing.seller_id
  const buttons = []

  function setBusy(value) {
    busy = value
    root.setAttribute('aria-busy', String(value))
    for (const button of buttons) button.disabled = value || stopped
    confirm.disabled = value || stopped
    cancel.disabled = value
    confirmation.disabled = value
  }

  for (const [type, label, cents, className] of [
    ['buy', 'Demo Buy', listing.sale_price_cents, 'btn btn-primary'],
    ['rent', 'Demo Rent · 30 days', listing.rental_price_cents, 'btn btn-outline-primary'],
  ]) {
    if (!Number.isSafeInteger(cents) || cents <= 0) continue
    const button = element('button', className, label)
    button.type = 'button'
    button.disabled = stopped
    button.addEventListener('click', () => {
      if (busy || stopped) return
      selectedType = type
      selectedButton = button
      confirmation.checked = false
      error.hidden = true
      status.textContent = ''
      summary.textContent = `${label}: ${formatEuroCents(cents)} · ${type === 'buy' ? 'perpetual nonexclusive license' : '30-day nonexclusive license'}`
      form.hidden = false
      confirmation.focus?.()
    })
    buttons.push(button)
    actions.append(button)
  }

  cancel.addEventListener('click', () => {
    if (busy) return
    form.hidden = true
    confirmation.checked = false
    selectedType = null
    selectedButton?.focus?.()
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || stopped || !selectedType) return
    if (!confirmation.checked) {
      error.textContent = 'Confirm that no real money will be charged before continuing.'
      error.hidden = false
      return
    }
    setBusy(true)
    error.hidden = true
    status.textContent = 'Completing Demo Checkout…'
    try {
      const result = await demoCheckout({ listingId: listing.listing_id, licenseType: selectedType })
      if (result.error || !result.licenseId) {
        const failure = result.error
        error.textContent = failure?.message || 'Demo Checkout could not be confirmed. Check My Library before trying again.'
        error.hidden = false
        status.textContent = ''
        stopped = !failure || failure.outcomeUnknown || [
          'authentication_required', 'access_denied', 'own_listing', 'listing_unavailable',
          'offer_unavailable', 'invalid_checkout', 'duplicate_purchase', 'setup_required', 'configuration',
        ].includes(failure.code)
        libraryLink.hidden = false
        confirmation.checked = false
        return
      }
      stopped = true
      form.hidden = true
      libraryLink.hidden = false
      status.textContent = `Demo Checkout successful. License ID: ${result.licenseId}. No real money was charged.`
      // The receipt uses the saved price/expiry, including a recovered previous rental.
      let receipt = null
      try {
        receipt = await getMyLicense(result.licenseId)
      } catch {
        // A failed receipt read cannot undo the confirmed checkout result.
      }
      if (receipt?.license && !receipt.error) {
        const license = receipt.license
        status.textContent += ` Demo price: ${formatEuroCents(license.price_cents)}. ${license.license_type === 'buy'
          ? 'Perpetual nonexclusive license.' : `Rental expires ${formatMarketplaceDate(license.expires_at)}; validity is checked using database time.`}`
      } else {
        status.textContent += ' View My Library for the saved price and license terms.'
      }
    } catch {
      // Never retry an ambiguous mutation automatically.
      stopped = true
      status.textContent = ''
      error.textContent = 'The checkout result could not be confirmed. Check My Library before trying again.'
      error.hidden = false
      libraryLink.hidden = false
    } finally {
      setBusy(false)
    }
  })

  if (!userId) status.textContent = 'Sign in before using Demo Checkout.'
  else if (stopped) status.textContent = 'You cannot buy or rent your own listing.'
  else if (!buttons.length) status.textContent = 'This listing has no available demo offers.'
  root.append(actions, notice, form, status, error, libraryLink)
  setBusy(false)
  return root
}
