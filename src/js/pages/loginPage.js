import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import {
  getSafeInternalRedirect,
  signInWithPassword,
} from '../services/authService.js'

renderNavbar('login')
renderFooter()
initPageTransitions()

const form = document.querySelector('#login-form')
const message = document.querySelector('#login-message')
const submitButton = form.querySelector('button[type="submit"]')
const submitLabel = submitButton.textContent

function showMessage(text, type) {
  message.hidden = false
  message.className = `alert alert-${type} mb-0`
  message.setAttribute('role', type === 'danger' ? 'alert' : 'status')
  message.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite')
  message.textContent = text
}

function setFieldError(name, text = '') {
  const field = form.elements.namedItem(name)
  const error = document.querySelector(`#${field.id}-error`)
  field.setAttribute('aria-invalid', String(Boolean(text)))
  error.textContent = text
  error.hidden = !text
}

function validateForm() {
  const email = form.elements.namedItem('email')
  const password = form.elements.namedItem('password')
  const errors = {
    email: !email.value.trim()
      ? 'Enter your email address.'
      : email.validity.typeMismatch
        ? 'Enter a valid email address.'
        : '',
    password: password.value ? '' : 'Enter your password.',
  }

  Object.entries(errors).forEach(([name, text]) => setFieldError(name, text))
  const firstInvalidField = Object.keys(errors).find((name) => errors[name])

  if (firstInvalidField) {
    form.elements.namedItem(firstInvalidField).focus()
    return null
  }

  return { email: email.value.trim(), password: password.value }
}

function setSubmitting(submitting) {
  Array.from(form.elements).forEach((field) => {
    field.disabled = submitting
  })
  form.setAttribute('aria-busy', String(submitting))
  submitButton.textContent = submitting ? 'Signing in...' : submitLabel
}

form.addEventListener('input', (event) => {
  if (event.target.name) {
    setFieldError(event.target.name)
    message.hidden = true
    message.textContent = ''
  }
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  message.hidden = true
  message.textContent = ''

  const values = validateForm()
  if (!values || form.getAttribute('aria-busy') === 'true') {
    return
  }

  setSubmitting(true)

  const result = await signInWithPassword(values)

  setSubmitting(false)

  if (result.error) {
    showMessage(result.error.message, 'danger')
    return
  }

  if (!result.session) {
    showMessage('Sign-in did not create an active session. Please try again.', 'danger')
    return
  }

  showMessage('Signed in. Taking you to your EchoVault page...', 'success')
  const requestedDestination = new URLSearchParams(window.location.search).get('redirect')
  window.location.replace(getSafeInternalRedirect(requestedDestination))
})
