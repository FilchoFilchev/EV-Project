import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import config from '../vite.config.js'

const read = (file) => readFileSync(file, 'utf8')
const pages = ['index', 'register', 'login', 'dashboard', 'studio', 'marketplace', 'voice-details', 'my-library', 'admin']
assert.deepEqual(Object.keys(config.input).sort(), [...pages].sort())
assert.equal(config.build.outDir, 'dist')
assert.equal(config.appType, 'mpa')
const modules = new Set()
for (const page of pages) {
  const html = read(`${page}.html`)
  assert.equal(config.input[page], resolve(`${page}.html`))
  assert.match(html, /<html lang="en"/)
  assert.match(html, /name="viewport"/)
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${page}: one main heading`)
  assert.match(html, /<main id="page-content"/)
  const script = html.match(/<script type="module" src="([^"]+)"/)[1]
  assert.ok(existsSync(script.slice(1)))
  assert.ok(!modules.has(script), `${page}: distinct page module`)
  modules.add(script)
  if (!['index', 'register', 'login'].includes(page)) {
    assert.match(html, /data-auth-state="pending"/)
    assert.match(read(script.slice(1)), page === 'admin' ? /requireAdmin\(/ : /requireAuthentication\(/)
  }
}
const netlify = read('netlify.toml')
assert.match(netlify, /^"\$schema" = "https:\/\/open-api.netlify.com\/netlify.schema.json"/)
assert.match(netlify, /command = "npm run build"/)
assert.match(netlify, /publish = "dist"/)
assert.match(netlify, /NODE_VERSION = "22"/)
assert.doesNotMatch(netlify, /\[\[redirects\]\]|VITE_SUPABASE|secret|service_role/)
const local = read('supabase/config.toml')
assert.match(local, /\[db.seed\][\s\S]*?enabled = false[\s\S]*?sql_paths = \[\]/)
assert.match(local, /site_url = "http:\/\/localhost:5173"/)
for (const port of [5173, 4173]) assert.ok(local.includes(`http://localhost:${port}/**`))
const schema = read('supabase/migrations/20261121174900_core_schema.sql')
const tables = [...schema.matchAll(/create table public\.(\w+)/gi)].map(([, table]) => table)
assert.equal(tables.length, 8)
for (const table of tables) assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations'], { encoding: 'utf8' }).trim(), '', 'Applied migrations unchanged')
assert.equal(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations'], { encoding: 'utf8' }).trim(), '', 'No new migration needed')
const history = execFileSync('git', ['log', '--format=%h %aI %s'], { encoding: 'utf8' }).trim().split('\n')
assert.ok(history.length >= 15, 'At least 15 authentic existing commits')
const days = new Set(history.map((line) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(line.split(' ')[1]))))
assert.ok(days.size >= 3, 'At least three calendar days in Europe/Sofia')
assert.deepEqual(execFileSync('git', ['ls-files', '*.env', '.env', '.env.*'], { encoding: 'utf8' }).trim().split('\n'), ['.env.example'])
for (const section of ['how-it-works', 'plans', 'terms', 'privacy']) assert.ok(read('index.html').includes(`id="${section}"`))
assert.match(read('src/js/components/navbar.js'), /Skip to main content/)
assert.match(read('src/js/components/footer.js'), /\/index.html#terms/)
const docs = ['README.md', 'docs/architecture.md', 'docs/er-diagram.md', 'docs/demo-script.md',
  'docs/demo-accounts.md', 'docs/test-checklist.md', 'docs/deployment.md', 'docs/prompt18-validation.md']
for (const file of docs) {
  const text = read(file)
  for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#|mailto:)/.test(target)) continue
    assert.ok(existsSync(resolve(dirname(file), target.split('#')[0])), `${file}: broken link ${target}`)
  }
}
assert.match(read('docs/architecture.md'), /```mermaid/)
assert.match(read('docs/er-diagram.md'), /erDiagram/)
const checklist = read('docs/test-checklist.md')
for (let number = 1; number <= 20; number++) assert.ok(checklist.includes(`T${String(number).padStart(2, '0')}`))
for (const page of pages) assert.ok(checklist.includes(`${page}.html`))
assert.match(read('docs/demo-accounts.md'), /PENDING/)
console.log(`PASS: Prompt 18 source/documentation contracts; nine MPA entries, 8 RLS table declarations, ${history.length} existing commits across ${days.size} Sofia calendar days, local setup, docs and hosting settings.`)
console.log('SKIP: Runtime database, responsive browser, production deployment and actual demo-account verification.')
