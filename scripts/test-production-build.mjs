import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, extname, dirname, relative } from 'node:path'
import { preview } from 'vite'
import config from '../vite.config.js'

const root = resolve(config.build.outDir)
assert.ok(existsSync(root), 'Run npm run build first')
const pages = Object.keys(config.input).map((name) => `${name}.html`)
assert.deepEqual(readdirSync(root).filter((file) => file.endsWith('.html')).sort(), [...pages].sort())
const assets = new Set()
function verifyReference(reference, owner) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) return
  const cleaned = decodeURIComponent(reference.split(/[?#]/)[0])
  if (!cleaned) return
  const path = cleaned.startsWith('/') ? resolve(root, `.${cleaned}`) : resolve(dirname(owner), cleaned)
  assert.ok(path.startsWith(`${root}/`) || path.startsWith(`${root}\\`), 'Asset stays in dist')
  assert.ok(existsSync(path), `Missing build asset ${reference} in ${relative(root, owner)}`)
  if (statSync(path).isFile() && extname(path) !== '.html') assets.add(path)
}
for (const page of pages) {
  const path = resolve(root, page)
  const html = readFileSync(path, 'utf8')
  assert.match(html, /<script type="module"[^>]+src="\/assets\//)
  assert.doesNotMatch(html, /\/(?:src|node_modules)\//)
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) verifyReference(reference, path)
}
for (const asset of assets) {
  const extension = extname(asset)
  if (!['.css', '.js'].includes(extension)) continue
  const source = readFileSync(asset, 'utf8')
  if (extension === '.css') {
    for (const [, reference] of source.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) verifyReference(reference, asset)
  } else {
    for (const [, direct, dynamic] of source.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) {
      const reference = direct ?? dynamic
      if (reference.startsWith('.') || reference.startsWith('/')) verifyReference(reference, asset)
    }
  }
}
const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } })
try {
  const { port } = server.httpServer.address()
  const origin = `http://127.0.0.1:${port}`
  for (const page of pages) {
    for (const suffix of ['', '?id=00000000-0000-4000-8000-000000000001']) {
      const response = await fetch(`${origin}/${page}${suffix}`)
      assert.equal(response.status, 200, `${page}: direct HTTP load`)
      assert.match(response.headers.get('content-type'), /text\/html/)
      const html = await response.text()
      const expectedTitle = readFileSync(resolve(page), 'utf8').match(/<title>([^<]+)<\/title>/)[1]
      assert.ok(html.includes(`<title>${expectedTitle}</title>`), `${page}: correct page returned`)
    }
  }
  for (const asset of assets) {
    const response = await fetch(`${origin}/${relative(root, asset).replaceAll('\\', '/')}`)
    assert.equal(response.status, 200, `HTTP asset ${relative(root, asset)}`)
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/)
    await response.arrayBuffer()
  }
  assert.equal((await fetch(`${origin}/missing-prompt18-page`)).status, 404, 'No SPA fallback')
  console.log(`PASS: Nine production HTML files, ${assets.size} referenced assets, 18 direct/query HTTP loads and missing-page 404 on loopback Vite preview.`)
  console.log('SKIP: Browser JavaScript/audio, Supabase runtime and Netlify CDN behavior. No deployment or remote requests.')
} finally {
  server.httpServer.closeAllConnections?.()
  await new Promise((done, reject) => server.httpServer.close((error) => error ? reject(error) : done()))
}
