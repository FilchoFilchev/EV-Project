import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { normalizeAudioMimeType } from '../src/js/utils/audioUploadValidation.js'

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.textContent = ''
    this.hidden = true
    this.paused = true
  }

  append(...elements) {
    for (const element of elements) {
      if (element.tagName === 'fragment') this.append(...element.children)
      else this.children.push(element)
    }
  }

  replaceChildren(...elements) {
    this.children = []
    this.append(...elements)
  }

  addEventListener(event, callback) { this.listeners.set(event, callback) }
  setAttribute(name, value) { this[name] = value }
  removeAttribute(name) { delete this[name] }
  click() { this.clicked = true; return this.listeners.get('click')?.() }
  remove() {}
  load() {}
  pause() { this.paused = true }
  async play() { this.paused = false }
  set innerHTML(value) { throw new Error(`Unsafe HTML rendering: ${value}`) }
}

const elements = new Map()
const links = []
const downloads = []
const revokedUrls = []
const title = '<img src=x onerror=alert(1)> Private voice'
const recording = {
  id: 'recording-1', title, category: 'Voice', description: '<script>unsafe()</script>',
  created_at: '2026-11-22T12:00:00Z',
  original: {
    id: 'original-1', storage_path: 'owner/original.webm', duration_seconds: 2,
    mime_type: 'audio/webm', file_size_bytes: 1024,
  },
}
const version = {
  id: 'edited-1', recording_id: recording.id, recording,
  effect_type: 'muffle', effect_settings: { intensity: 80 },
  storage_path: 'owner/edited.wav', duration_seconds: 2,
  mime_type: 'audio/wav', file_size_bytes: 176444,
  created_at: '2026-11-22T12:01:00Z',
}
let editedResult = { versions: [version], error: null }
const context = vm.createContext({
  console, Intl, Date, Map, Number,
  document: {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element())
      return elements.get(selector)
    },
    createElement(tagName) {
      const element = new Element(tagName)
      if (tagName === 'a') links.push(element)
      return element
    },
    createDocumentFragment: () => new Element('fragment'),
    body: new Element('body'),
  },
  window: {
    location: { hash: '#edited-versions' },
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
  },
  URL: {
    createObjectURL: () => `blob:private-${downloads.length}`,
    revokeObjectURL: (url) => revokedUrls.push(url),
  },
  renderNavbar() {}, renderFooter() {}, initPageTransitions() {},
  requireAuthentication: async () => ({ id: 'owner' }),
  listMyOriginalRecordings: async () => ({ recordings: [recording], error: null }),
  listMyEditedVersions: async () => editedResult,
  downloadOriginalAudio: async (path) => {
    downloads.push(path)
    return { blob: { type: path.endsWith('.wav') ? 'audio/wav' : 'audio/webm' }, error: null }
  },
  normalizeAudioMimeType,
})
const source = (await readFile(new URL('../src/js/pages/myLibraryPage.js', import.meta.url), 'utf8'))
  .replace(/^import .*\r?\n/gm, '')
  .replace(/loadLibrary\(\)\s*$/, 'globalThis.libraryReady = loadLibrary()')
vm.runInContext(source, context)
await context.libraryReady

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)]
}
function buttonIn(selector, text) {
  return descendants(elements.get(selector)).find((node) => node.tagName === 'button' && node.textContent === text)
}

assert.equal(elements.get('#edited-versions-tab').clicked, true)
assert.equal(elements.get('#library-list').children.length, 1)
assert.equal(elements.get('#edited-library-list').children.length, 1)
assert.equal(elements.get('#library-empty').hidden, true)
assert.equal(elements.get('#edited-library-empty').hidden, true)
const editedNodes = descendants(elements.get('#edited-library-list'))
assert.ok(editedNodes.some((node) => node.tagName === 'h2' && node.textContent === `${title} — Muffle`))
assert.ok(editedNodes.some((node) => node.tagName === 'dd' && node.textContent === '80%'))
assert.ok(editedNodes.some((node) => node.textContent === '<script>unsafe()</script>'))

await buttonIn('#library-list', 'Play').click()
await buttonIn('#edited-library-list', 'Play').click()
assert.deepEqual(downloads, ['owner/original.webm', 'owner/edited.wav'])
assert.equal(elements.get('#library-playback-title').textContent, `${title} — Muffle`)
assert.equal(revokedUrls.length, 1)

await buttonIn('#edited-library-list', 'Download').click()
assert.equal(downloads.at(-1), 'owner/edited.wav')
assert.ok(links.at(-1).download.endsWith('-Muffle.wav'))
assert.equal(links.at(-1).clicked, true)
await buttonIn('#library-list', 'Download').click()
assert.equal(downloads.at(-1), 'owner/original.webm')
assert.ok(links.at(-1).download.endsWith('.webm'))

editedResult = { versions: [], error: null }
await vm.runInContext('loadEditedVersions()', context)
assert.equal(elements.get('#edited-library-empty').hidden, false)
assert.equal(elements.get('#edited-library-list').children.length, 0)
editedResult = { versions: null, error: { message: 'Access denied' } }
await vm.runInContext('loadEditedVersions()', context)
assert.equal(elements.get('#edited-library-error').hidden, false)
assert.equal(elements.get('#edited-library-error').textContent, 'Access denied')
assert.equal(elements.get('#library-list').children.length, 1)

console.log('Edited library tests passed (original/edited playback, downloads, safe text, empty/error states).')
