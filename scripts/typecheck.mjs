// The typecheck gate: runs tsc once for each zone config and fails on any error.
// It runs all configs, so one log shows every failed zone.
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules/typescript/bin/tsc')
const configs = ['tsconfig.main.json', 'tsconfig.renderer.json', 'tsconfig.shared.json']

let failed = 0
for (const config of configs) {
  const run = spawnSync(process.execPath, [tsc, '-p', config, '--noEmit'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (run.status === 0) {
    console.log(`typecheck: ${config} passed`)
    continue
  }
  failed += 1
  console.error(`typecheck: ${config} FAILED`)
  console.error(`${run.stdout}${run.stderr}`.trim())
}
if (failed > 0) {
  console.error(`typecheck: FAILED in ${failed} of ${configs.length} zone configs`)
  process.exitCode = 1
}
