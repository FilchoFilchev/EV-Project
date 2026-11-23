import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const files = ['vite.config.js']
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path)
  }
}
collect('src')
collect('scripts')
let failures = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0 || result.error) {
    failures++
    console.error(`FAIL ${file}: ${result.error?.message ?? result.stderr}`)
  }
}
console.log(`${failures ? 'FAIL' : 'PASS'}: JavaScript syntax checked in ${files.length} files; scripts were parsed, not executed.`)
if (failures) process.exitCode = 1
