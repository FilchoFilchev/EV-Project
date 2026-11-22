import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { signUp } from '../services/authService.js'

renderNavbar('register')
renderFooter()
initPageTransitions()

const form = document.querySelector('#register-form')
const message = document.querySelector('#register-message')
const submitButton = form.querySelector('button[type="submit"]')
const submitLabel = submitButton.textContent

function showMessage(text, type) {
  message.hidden = false
  message.className = `alert alert-${type} mb-0`
  message.setAttribute('role', type === 'danger' ? 'alert' : 'status')
  message.setAttribute('aria-live', type === 'danger' ? 'assertive' : 'polite')
  message.textContent = text
}

function clearMessage() {
  message.hidden = true
  message.textContent = ''
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
      : email.validity.typeMismatch
        ? 'Enter a valid email address.'
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

  return { displayName, email: email.value.trim(), password }
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
  clearMessage()

  const values = validateForm()
  if (!values || form.getAttribute('aria-busy') === 'true') {
    return
  }

  setSubmitting(true)

  const result = await signUp(values)

  setSubmitting(false)

  if (result.error) {
    if (result.error.code === 'weak_password') {
      setFieldError('password', result.error.message)
      form.elements.namedItem('password').focus()
    }
    showMessage(
      result.error.message,
      result.error.code === 'duplicate_account' ? 'info' : 'danger'
    )
    return
  }

  if (result.session) {
    showMessage('Your account is ready. Taking you to your dashboard...', 'success')
    window.location.replace('/dashboard.html')
    return
  }

  showMessage(
    'If registration succeeded, check your inbox for a confirmation link before signing in. If you already have an account, sign in instead.',
    'success'
  )
})
