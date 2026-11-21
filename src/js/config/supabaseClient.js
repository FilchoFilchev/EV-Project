import { createClient } from '@supabase/supabase-js'

function validateBrowserConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url) {
    return {
      supabase: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL in .env.local.',
    }
  }

  if (!publishableKey) {
    return {
      supabase: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      supabase: null,
      error: 'Supabase configuration is invalid: VITE_SUPABASE_URL must be a valid URL.',
    }
  }

  if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname) {
    return {
      supabase: null,
      error: 'Supabase configuration is invalid: VITE_SUPABASE_URL must use HTTPS.',
    }
  }

  if (/^(?:sb_secret_|service_role|eyJ)/i.test(publishableKey) || publishableKey.includes('secret')) {
    return {
      supabase: null,
      error: 'Supabase configuration is invalid: only a publishable browser key may be used.',
    }
  }

  return { url, publishableKey, supabase: null, error: null }
}

const config = validateBrowserConfig()

let supabase = config.supabase
let configurationError = config.error

if (!configurationError) {
  try {
    supabase = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  } catch {
    configurationError =
      'Supabase could not be initialized. Check the browser-safe project URL and publishable key.'
  }
}

export { supabase, configurationError }
