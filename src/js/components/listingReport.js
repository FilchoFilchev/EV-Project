import { createListingReport, getMyListingReport } from '../services/reportService.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createListingReportForm(listing, { userId } = {}) {
  const root = element('section', 'mt-4')
  root.setAttribute('aria-label', 'Report listing')
  const toggle = element('button', 'btn btn-outline-danger', 'Report')
  toggle.type = 'button'
  toggle.setAttribute('aria-expanded', 'false')
  const form = element('form', 'border rounded p-3 mt-3')
  form.hidden = true
  const fieldId = `listing-report-reason-${listing.listing_id}`
  form.id = `listing-report-form-${listing.listing_id}`
  toggle.setAttribute('aria-controls', form.id)
  const label = element('label', 'form-label', 'Reason for reporting')
  label.htmlFor = fieldId
  const reason = element('textarea', 'form-control mb-2')
  reason.id = fieldId
  reason.name = 'reason'
  reason.rows = 4
  reason.required = true
  reason.maxLength = 1000
  const help = element('p', 'small text-secondary', 'Explain your concern in 1–1,000 characters. Avoid including sensitive personal information.')
  help.id = `${fieldId}-help`
  reason.setAttribute('aria-describedby', help.id)
  const actions = element('div', 'd-flex flex-wrap gap-2')
  const submit = element('button', 'btn btn-danger', 'Submit report')
  submit.type = 'submit'
  const cancel = element('button', 'btn btn-outline-secondary', 'Cancel')
  cancel.type = 'button'
  actions.append(submit, cancel)
  form.append(label, reason, help, actions)
  const status = element('p', 'small mt-2 mb-0')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const error = element('div', 'alert alert-danger mt-3 mb-0')
  error.setAttribute('role', 'alert')
  error.hidden = true
  let busy = false
  let stopped = !userId

  function setBusy(value) {
    busy = value
    root.setAttribute('aria-busy', String(value))
    toggle.disabled = value || stopped
    submit.disabled = value || stopped
    cancel.disabled = value
    reason.disabled = value || stopped
  }

  function showError(failure) {
    status.textContent = ''
    error.textContent = failure?.message || 'Reporting is temporarily unavailable. Please try again.'
    error.hidden = false
    if (['authentication_required', 'access_denied', 'listing_unavailable', 'not_found', 'invalid_listing', 'configuration', 'setup_required'].includes(failure?.code)) stopped = true
  }

  function showExisting(report) {
    stopped = true
    form.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    error.hidden = true
    status.textContent = report?.status === 'resolved'
      ? 'You already reported this listing. Your report has been resolved.'
      : 'You already reported this listing. Your report is awaiting review.'
  }

  toggle.addEventListener('click', () => {
    if (busy || stopped) return
    form.hidden = !form.hidden
    toggle.setAttribute('aria-expanded', String(!form.hidden))
    if (!form.hidden) reason.focus?.()
  })
  cancel.addEventListener('click', () => {
    if (busy) return
    form.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    toggle.focus?.()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || stopped || form.hidden) return
    const text = reason.value.trim()
    if (!text || Array.from(text).length > 1000) {
      error.textContent = 'Enter a report reason between 1 and 1,000 characters.'
      error.hidden = false
      reason.focus?.()
      return
    }
    setBusy(true)
    status.textContent = 'Submitting report…'
    error.hidden = true
    try {
      const result = await createListingReport(listing.listing_id, text)
      if (result.error?.code === 'duplicate_report') {
        showExisting()
      } else if (result.error || !result.reportId) {
        showError(result.error)
      } else {
        stopped = true
        form.hidden = true
        reason.value = ''
        toggle.setAttribute('aria-expanded', 'false')
        status.textContent = 'Report submitted. An administrator will review your concern.'
      }
    } catch {
      showError({ message: 'We could not confirm the report. Please try again; duplicate reports are prevented.' })
    } finally {
      setBusy(false)
    }
  })

  async function loadExisting() {
    setBusy(true)
    status.textContent = 'Checking your report status…'
    try {
      const result = await getMyListingReport(listing.listing_id)
      if (result.error) showError(result.error)
      else if (result.report) showExisting(result.report)
      else status.textContent = ''
    } catch {
      showError({ message: 'Unable to check your report status. You can still submit a report; duplicates are prevented.' })
    } finally {
      setBusy(false)
    }
  }

  root.append(toggle, form, status, error)
  if (userId) void loadExisting()
  else {
    status.textContent = 'Sign in to report this listing.'
    setBusy(false)
  }
  return root
}
