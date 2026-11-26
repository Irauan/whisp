// Checks that each source file under src belongs to at least one zone config.
// It lists the files of each config with `tsc --listFilesOnly`.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ZONE_CONFIGS = [
  'tsconfig.main.json',
  'tsconfig.renderer.json',
  'tsconfig.shared.json',
  'tsconfig.test.json'
]
const SOURCE = /\.(ts|tsx|mts|cts)$/

function walk(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (SOURCE.test(entry.name)) found.push(path)
  }
  return found
}

const normalize = (path) => resolve(path).replaceAll('\\', '/').toLowerCase()

/**
 * @param {{ root?: string, configs?: string[] }} options Paths of configs are relative to root.
 * @returns {string[]} Source files under `<root>/src` that are in no config, relative to root.
 */
export function findUncoveredFiles({ root = ROOT, configs = ZONE_CONFIGS } = {}) {
  const tsc = join(ROOT, 'node_modules/typescript/bin/tsc')
  const covered = new Set()
  for (const config of configs) {
    const run = spawnSync(process.execPath, [tsc, '-p', config, '--listFilesOnly'], {
      cwd: root,
      encoding: 'utf8'
    })
    if (run.status !== 0) throw new Error(`tsc failed for ${config}.\n${run.stdout}${run.stderr}`)
    for (const line of run.stdout.split(/\r?\n/)) if (line.trim()) covered.add(normalize(line.trim()))
  }
  return walk(join(root, 'src'))
    .filter((file) => !covered.has(normalize(file)))
    .map((file) => relative(root, file).replaceAll('\\', '/'))
    .sort()
}
