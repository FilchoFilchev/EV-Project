import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { validateOriginalAudio } from '../src/js/utils/audioUploadValidation.js'

// Run the actual Studio controller with a small DOM and service doubles.
// No microphone, network, Storage, or saved user data is accessed.
const elements = new Map()
const effectInputs = []
class Element {
  constructor() {
    this.children = []
    this.listeners = new Map()
    this.value = ''
    this.disabled = false
    this.hidden = true
    this.paused = true
    this.readyState = 1
    this.duration = 2
    const classes = new Set()
    this.classList = {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value),
      contains: (value) => classes.has(value),
    }
  }
  get textContent() { return this.text || this.children.map((child) => child.textContent).join('') }
  set textContent(value) { this.text = String(value); this.children = [] }
  get checked() { return Boolean(this.isChecked) }
  set checked(value) {
    if (value && effectInputs.includes(this)) effectInputs.forEach((input) => { input.isChecked = false })
    this.isChecked = value
  }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.text = ''; this.children = [...children] }
  addEventListener(event, callback) { this.listeners.set(event, callback) }
  removeEventListener(event) { this.listeners.delete(event) }
  setAttribute(name, value) { this[name] = value }
  removeAttribute(name) { delete this[name] }
  load() {}
  pause() { this.paused = true }
  async play() { this.paused = false }
  focus() {}
}
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, new Element())
  return elements.get(selector)
}
for (const value of ['original', 'muffle', 'distortion', 'echo']) {
  const input = element(`#effect-${value}`)
  input.value = value
  effectInputs.push(input)
}
element('#effect-original').checked = true
element('#effect-intensity').value = '50'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
let eligibility = deferred()
let saveResult = deferred()
let editedSaveCalls = 0
const previewCalls = []
class RecordingService {
  state = 'idle'
  subscribe(callback) { callback({ state: this.state }); return () => {} }
  start() {}
  stop() {}
  cancel() {}
  dispose() {}
}
const sourceBlob = new Blob(['original audio'], { type: 'audio/webm' })
const context = vm.createContext({
  console, Blob, Number, String, Array, Boolean, Set, performance,
  document: {
    querySelector: element,
    querySelectorAll: () => effectInputs,
    createElement: () => new Element(),
    createTextNode: (textContent) => ({ textContent }),
  },
  window: { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} },
  URL: { createObjectURL: () => 'blob:original', revokeObjectURL() {} },
  OfflineAudioContext: class {},
  renderNavbar() {}, renderFooter() {}, initPageTransitions() {},
  RecordingService,
  getRecordingSupport: () => ({ supported: true, message: '' }),
  DEFAULT_MUFFLE_INTENSITY: 50,
  createAudioPreviewEngine: () => ({
    supported: true, connected: false,
    apply: async (effect) => { previewCalls.push(effect) },
    reset() {}, setIntensity() {}, resume: async () => {}, dispose: async () => {},
  }),
  requireAuthentication: async () => ({ id: 'owner' }),
  getPremiumEligibility: async () => eligibility.promise,
  saveEditedAudio: async (metadata) => {
    editedSaveCalls += 1
    assert.equal(metadata.recordingId, 'saved-original')
    assert.equal(metadata.sourceBlob, sourceBlob)
    assert.equal(metadata.effectType, 'muffle')
    assert.equal(metadata.intensity, 50)
    metadata.onProgress('Rendering selected effect...')
    return saveResult.promise
  },
  createOriginalRecording() { throw new Error('Unexpected original metadata mutation') },
  findOwnedOriginalByPath() { throw new Error('Unexpected original lookup') },
  removeUnreferencedAudio() { throw new Error('Unexpected cleanup') },
  uploadOriginalAudio() { throw new Error('Unexpected original upload') },
  validateOriginalAudio,
  testSource: sourceBlob,
})
const source = (await readFile(new URL('../src/js/pages/studioPage.js', import.meta.url), 'utf8'))
  .replace(/^import ['"][^'"]+['"]\r?\n/gm, '')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
vm.runInContext(source, context)
vm.runInContext("setPlaybackSource(testSource, 'file', 'Local audio'); setPlaybackReady()", context)

function assertOriginalAvailable() {
  assert.equal(element('#record-button').disabled, false)
  assert.equal(element('#audio-file').disabled, false)
  assert.equal(element('#playback-toggle').disabled, false)
  assert.equal(element('#effect-original').disabled, false)
}
function assertEffectsLocked() {
  for (const effect of ['muffle', 'distortion', 'echo']) {
    assert.equal(element(`#effect-${effect}`).disabled, true)
  }
  assert.equal(element('#save-edited-button').disabled, true)
}

// Entitlement is initially unknown: fail closed while original tools still work.
assertOriginalAvailable()
assertEffectsLocked()
assert.equal(element('#save-original-button').disabled, false)
await vm.runInContext('handleEffectPreview()', context)
assert.deepEqual(previewCalls, ['original'])
eligibility.resolve({ premium: true, error: 'Cannot verify Premium access' })
await new Promise(setImmediate)
assertEffectsLocked()
assertOriginalAvailable()

eligibility = { promise: Promise.resolve({ premium: false, error: null }) }
await vm.runInContext('refreshPremiumAccess()', context)
assertEffectsLocked()
assertOriginalAvailable()

eligibility = { promise: Promise.resolve({ premium: true, error: null }) }
await vm.runInContext('refreshPremiumAccess()', context)
element('#effect-muffle').checked = true
vm.runInContext('handleEffectSelectionChange()', context)
assert.equal(element('#effect-muffle').disabled, false)
assert.equal(element('#save-edited-button').disabled, true, 'Saving an original is required first')
await vm.runInContext('handleSaveEdited()', context)
assert.equal(editedSaveCalls, 0)

vm.runInContext("markOriginalSaved({ id: 'saved-original', title: 'Private voice' }); updateControls(recordingService.state)", context)
assert.equal(element('#save-edited-button').disabled, false)
const pendingSave = vm.runInContext('handleSaveEdited()', context)
assert.equal(editedSaveCalls, 1)
for (const selector of ['#record-button', '#audio-file', '#playback-toggle', '#save-original-button', '#effect-muffle', '#effect-intensity', '#effect-preview-button', '#effect-reset-button', '#save-edited-button']) {
  assert.equal(element(selector).disabled, true, `${selector} must be disabled during an edited save`)
}
await vm.runInContext('handleSaveEdited()', context)
assert.equal(editedSaveCalls, 1, 'Repeated save clicks must not create concurrent versions')
saveResult.resolve({ version: { id: 'edited-version' }, error: null })
await pendingSave
assertOriginalAvailable()
assert.equal(element('#effect-muffle').disabled, false)
assert.equal(element('#save-edited-button').disabled, false)
assert.equal(element('#save-original-button').disabled, true, 'The already saved original must stay saved')
const libraryLink = element('#save-edited-status').children.find((child) => child.href)
assert.equal(libraryLink.href, '/my-library.html#edited-versions')

saveResult = deferred()
const uncertainSave = vm.runInContext('handleSaveEdited()', context)
saveResult.resolve({ version: null, error: { message: 'Save result is uncertain', outcomeUnknown: true } })
await uncertainSave
assert.equal(element('#save-edited-button').disabled, true, 'An uncertain save must block duplicate retries')
assertOriginalAvailable()
assert.equal(element('#save-edited-error').hidden, false)

console.log('Studio Premium tests passed (fail-closed gating, original tools, saved-original prerequisite, save concurrency and completion).')
