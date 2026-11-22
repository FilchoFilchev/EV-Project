import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { signUp } from '../services/authService.js'
import {
  INVALID_PUBLIC_EMAIL_MESSAGE,
  normalizePublicEmail,
} from '../utils/emailValidator.js'

renderNavbar('register')
renderFooter()
initPageTransitions()

const form = document.querySelector('#register-form')
const registerPanel = document.querySelector('#register-panel')
const message = document.querySelector('#register-message')
const submitButton = form.querySelector('button[type="submit"]')
const submitLabel = submitButton.textContent
let submissionPending = false

function showMessage(text, type) {
  message.hidden = false
  message.className = `alert alert-${type} mb-0`
  const isAlert = type === 'danger' || type === 'warning'
  message.setAttribute('role', isAlert ? 'alert' : 'status')
  message.setAttribute('aria-live', isAlert ? 'assertive' : 'polite')
  message.textContent = text
}

function clearMessage() {
  message.hidden = true
  message.textContent = ''
}

function showConfirmationScreen(email) {
  form.reset()

  const panel = document.createElement('section')
  panel.id = 'registration-confirmation'
  panel.className = registerPanel.className
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-live', 'polite')
  panel.setAttribute('aria-labelledby', 'registration-confirmation-heading')

  const card = document.createElement('div')
  card.className = 'card auth-confirmation-card text-center'

  const cardBody = document.createElement('div')
  cardBody.className = 'card-body p-4 p-md-5'

  const icon = document.createElement('span')
  icon.className = 'auth-confirmation-icon mb-4'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = '\u2713'

  const heading = document.createElement('h1')
  heading.id = 'registration-confirmation-heading'
  heading.className = 'h2 mb-3'
  heading.tabIndex = -1
  heading.textContent = 'Check your inbox!'

  const instructions = document.createElement('p')
  instructions.className = 'mb-2'
  instructions.textContent =
    'If registration can proceed, a verification link will be sent to this address:'

  const submittedEmail = document.createElement('p')
  submittedEmail.className = 'fw-semibold text-break mb-3'
  submittedEmail.textContent = email

  const nextStep = document.createElement('p')
  nextStep.className = 'text-secondary mb-4'
  nextStep.textContent =
    'Follow the link in that email to verify your address. If you already have an account, sign in instead.'

  const signInLink = document.createElement('a')
  signInLink.className = 'btn btn-primary btn-lg auth-confirmation-button'
  signInLink.href = '/login.html'
  signInLink.textContent = 'Back to Sign In'

  cardBody.append(icon, heading, instructions, submittedEmail, nextStep, signInLink)
  card.append(cardBody)
  panel.append(card)
  registerPanel.replaceWith(panel)
  heading.focus()
}

function setFieldError(name, text = '') {
  const field = form.elements.namedItem(name)
  const error = document.querySelector(`#${field.id}-error`)
  field.setAttribute('aria-invalid', String(Boolean(text)))
  error.textContent = text
  error.hidden = !text
}

function validateForm() {
  const displayName = form.elements.namedItem('displayName').value.trim()
  const email = form.elements.namedItem('email')
  const normalizedEmail = normalizePublicEmail(email.value)
  const password = form.elements.namedItem('password').value
  const confirmPassword = form.elements.namedItem('confirmPassword').value
  const rightsConfirmation = form.elements.namedItem('rightsConfirmation')
  const errors = {
    displayName: !displayName
      ? 'Enter a display name.'
      : displayName.length > 100
        ? 'Use 100 characters or fewer.'
        : '',
    email: !email.value.trim()
      ? 'Enter your email address.'
      : email.validity.typeMismatch || email.validity.tooLong || normalizedEmail.error
        ? INVALID_PUBLIC_EMAIL_MESSAGE
        : '',
    password: !password
      ? 'Enter a password.'
      : password.length < 8
        ? 'Use at least 8 characters.'
        : '',
    confirmPassword: !confirmPassword
      ? 'Confirm your password.'
      : password !== confirmPassword
        ? 'Passwords do not match.'
        : '',
    rightsConfirmation: rightsConfirmation.checked
      ? ''
      : 'Confirm that you have permission to use the voices you share.',
  }

  Object.entries(errors).forEach(([name, text]) => setFieldError(name, text))
  const firstInvalidField = Object.keys(errors).find((name) => errors[name])

  if (firstInvalidField) {
    form.elements.namedItem(firstInvalidField).focus()
    return null
  }

  email.value = normalizedEmail.email
  return { displayName, email: normalizedEmail.email, password }
}

function setSubmitting(submitting) {
  Array.from(form.elements).forEach((field) => {
    field.disabled = submitting
  })
  form.setAttribute('aria-busy', String(submitting))
  submitButton.textContent = submitting ? 'Creating account...' : submitLabel
}

form.addEventListener('input', (event) => {
  if (event.target.name) {
    setFieldError(event.target.name)
    clearMessage()

    if (
      event.target.name === 'password' &&
      form.elements.namedItem('confirmPassword').value
    ) {
      setFieldError(
        'confirmPassword',
        event.target.value === form.elements.namedItem('confirmPassword').value
          ? ''
          : 'Passwords do not match.'
      )
    }
  }
})

form.addEventListener('change', (event) => {
  if (event.target.name === 'rightsConfirmation') {
    setFieldError('rightsConfirmation')
  }
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submissionPending) {
    return
  }

  clearMessage()

  const values = validateForm()
  if (!values) {
    return
  }

  submissionPending = true
  setSubmitting(true)

  let result
  try {
    result = await signUp(values)
  } finally {
    submissionPending = false
    setSubmitting(false)
  }

  if (result.error) {
    if (result.error.code === 'email_address_invalid') {
      setFieldError('email', result.error.message)
      form.elements.namedItem('email').focus()
      return
    }

    if (result.error.code === 'weak_password') {
      setFieldError('password', result.error.message)
      form.elements.namedItem('password').focus()
    }

    const messageType =
      result.error.code === 'email_exists' || result.error.code === 'user_already_exists'
        ? 'secondary'
        : [
              'over_email_send_rate_limit',
              'over_request_rate_limit',
              'email_address_not_authorized',
              'auth_request_limited',
              'auth_service_unavailable',
              'network_error',
            ].includes(result.error.code)
          ? 'warning'
          : 'danger'

    showMessage(
      result.error.message,
      messageType
    )
    return
  }

  if (result.session) {
    showMessage('Your account is ready. Taking you to your dashboard...', 'success')
    window.location.replace('/dashboard.html')
    return
  }

  showConfirmationScreen(values.email)
})
