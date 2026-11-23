import { configurationError, supabase } from '../config/supabaseClient.js'
import { isUuid } from '../utils/listingValidation.js'

function failure(code = 'dashboard_load_failed') {
  return { message: 'Your overview could not be loaded. Check your connection and refresh.', code }
}

// Counts are exact database counts, independent of the REST row limit. These
// reads stay scoped to the verified caller; RLS remains the authorization boundary.
export async function getDashboardSummary() {
  if (!supabase) return { summary: null, error: { message: configurationError, code: 'configuration' } }
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !isUuid(auth?.user?.id)) {
      return { summary: null, error: { message: 'Sign in again to view your overview.', code: 'authentication_required' } }
    }
    const userId = auth.user.id
    const results = await Promise.all([
      supabase.from('voice_recordings').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      supabase.from('voice_versions').select('id,recording:voice_recordings!inner(owner_id)', { count: 'exact', head: true })
        .eq('recording.owner_id', userId).neq('effect_type', 'original'),
      supabase.from('listings').select('id,version:voice_versions!inner(recording:voice_recordings!inner(owner_id))', { count: 'exact', head: true })
        .eq('version.recording.owner_id', userId).eq('status', 'published')
        .eq('version.recording.visibility', 'public').not('preview_path', 'is', null),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('buyer_id', userId),
      supabase.from('voice_recordings').select('id,owner_id,title,category,created_at').eq('owner_id', userId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(5),
    ])
    if (results.some((result) => result.error)) return { summary: null, error: failure() }
    const counts = results.slice(0, 4).map((result) => result.count)
    const recent = results[4].data
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) || !Array.isArray(recent) ||
        recent.some((row) => row.owner_id !== userId || !isUuid(row.id) ||
          typeof row.title !== 'string' || typeof row.category !== 'string' ||
          !Number.isFinite(Date.parse(row.created_at)))) {
      return { summary: null, error: failure() }
    }
    return {
      summary: {
        recordings: counts[0], edited: counts[1], listings: counts[2], licenses: counts[3],
        recent: recent.map(({ id, title, category, created_at }) => ({ id, title, category, created_at })),
      },
      error: null,
    }
  } catch {
    return { summary: null, error: failure() }
  }
}
