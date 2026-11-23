import { spawnSync } from 'node:child_process'

// Explicit offline allowlist. Never discover/execute live API or cleanup scripts.
const prompt18 = ['test-dashboard.mjs', 'test-supabase-config.mjs', 'test-prompt18.mjs']
const regressions = [
  'test-audio-engine.mjs', 'test-audio-export.mjs', 'test-audio-upload-validation.mjs',
  'test-studio-premium.mjs', 'test-edited-save.mjs', 'test-edited-library.mjs',
  'test-listing-validation.mjs', 'test-listing-preview.mjs', 'test-listing-service.mjs',
  'test-listing-ui.mjs', 'test-prompt13-sql-contract.mjs', 'test-preview-upload-policy.mjs',
  'test-preview-upload-request.mjs', 'test-storage-error-diagnostics.mjs',
  'test-marketplace-filters.mjs', 'test-marketplace-browse-service.mjs', 'test-marketplace-ui.mjs',
  'test-license-service.mjs', 'test-demo-checkout-ui.mjs', 'test-prompt15-sql-contract.mjs',
  'test-licensed-audio-service.mjs', 'test-licensed-audio-ui.mjs', 'test-acquired-licenses-ui.mjs',
  'test-prompt16-sql-contract.mjs', 'test-moderation-services.mjs', 'test-admin-ui.mjs',
  'test-listing-report-ui.mjs', 'test-admin-navigation.mjs', 'test-prompt17-sql-contract.mjs',
]
if (process.argv.slice(2).some((arg) => arg !== '--prompt18')) throw new Error('Unknown test option')
const tests = process.argv.includes('--prompt18') ? prompt18 : [...prompt18, ...regressions]
let failures = 0
for (const file of tests) {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning', `scripts/${file}`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 60_000,
  })
  if (result.status !== 0 || result.error) {
    failures++
    console.error(`FAIL ${file}\n${result.error?.message ?? ''}${result.stdout ?? ''}${result.stderr ?? ''}`)
  } else console.log(`PASS ${file}`)
}
console.log(`${tests.length - failures}/${tests.length} local offline suites passed.`)
console.log('SKIP: Database SQL/RLS/REST, real browser audio, remote data and deployment checks. No live attack/cleanup scripts run.')
if (failures) process.exitCode = 1
