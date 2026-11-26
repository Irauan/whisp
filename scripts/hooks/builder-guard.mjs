// The builder guard: a PreToolUse hook of the builder role (.claude/agents/builder.md).
// It blocks Edit and Write on two kinds of path:
// - the locked paths: tests/acceptance/**, tests/simulated-agent/** and tests/locks.json
// - the real Aether data folder: %APPDATA%\aether\** (and AETHER_DATA_DIR when it is set)
//
// The hook gets the call as JSON on stdin. Exit code 2 blocks the call and sends stderr to the
// agent. Exit code 0 allows it. The guard blocks a call that it cannot read.
//
// It does not cover writes through Bash. The reviewer checks the diff of each story.
//
// A path is judged after these steps, so that a variation does not pass:
// - Relative paths resolve against the folder of the call.
// - Windows ignores a trailing dot or space in a name and reads `name:stream` as a stream of
//   `name`. The guard removes both from each segment.
// - Dot segments resolve. A link or junction resolves to its target: the guard resolves the
//   nearest existing folder with the real path.
// - The comparison ignores letter case and the kind of slash.
// - A locked path matches anywhere in the path, so a `.git` folder planted higher up cannot
//   hide it.
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARDED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const LOCKED_FOLDERS = ['acceptance', 'simulated-agent']

/** Removes what Windows ignores in a name, segment by segment. */
function cleanSegments(path) {
  return path
    .replace(/^(\\\\|\/\/)[?.][\\/]/, '') // the long-path and device prefixes
    .split(/[\\/]/)
    .map((segment, index) => {
      if (segment === '.' || segment === '..') return segment
      if (index === 0 && /^[a-z]:$/i.test(segment)) return segment
      return segment.replace(/:.*$/, '').replace(/[. ]+$/, '')
    })
    .filter((segment, index) => segment !== '' || index === 0)
    .join('/')
}

/** Resolves a path with the real path of its nearest existing folder. */
function realPath(path) {
  const rest = []
  let current = path
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return path
      rest.push(basename(current))
      current = parent
    }
  }
}

/** The path as the guard compares it: absolute, real, lower case, with forward slashes. */
function canonical(path, cwd) {
  return realPath(resolve(cwd, cleanSegments(path))).replaceAll('\\', '/').toLowerCase()
}

/** The locked path that `path` falls under, or null. `path` comes from `canonical`. */
function lockedPath(path) {
  const parts = path.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] !== 'tests') continue
    const next = parts[i + 1]
    if (LOCKED_FOLDERS.includes(next)) return `tests/${next}/**`
    if (next === 'locks.json' && i + 2 === parts.length) return 'tests/locks.json'
  }
  return null
}

/** The data folders of the real app: the Electron folder, and the folder of AETHER_DATA_DIR. */
function dataFolders(env, cwd) {
  const roaming = env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  const folders = [canonical(join(roaming, 'aether'), cwd)]
  if (env.AETHER_DATA_DIR) folders.push(canonical(env.AETHER_DATA_DIR, cwd))
  return folders
}

/**
 * Judges one tool call.
 * @param {{ toolName: string, toolInput: unknown, cwd?: string, env?: Record<string, string | undefined> }} call
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ toolName, toolInput, cwd = process.cwd(), env = process.env }) {
  if (!GUARDED_TOOLS.has(toolName)) return { block: false }
  const target = toolInput?.file_path ?? toolInput?.notebook_path
  if (typeof target !== 'string' || target === '') {
    return { block: true, reason: `Blocked: the ${toolName} call has no path, so the builder guard cannot check it.` }
  }
  const path = canonical(target, cwd)
  const locked = lockedPath(path)
  if (locked) {
    return {
      block: true,
      reason: `Blocked: ${target} is a locked path (${locked}). The builder never changes a locked file. Dispute the test with the coordinator.`
    }
  }
  for (const folder of dataFolders(env, cwd)) {
    if (path === folder || path.startsWith(`${folder}/`)) {
      return {
        block: true,
        reason: `Blocked: ${target} is in the real Aether data folder. Never write there. Use a fake profile in a temporary folder for probes.`
      }
    }
  }
  return { block: false }
}

function main() {
  let input
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    console.error('Blocked: the builder guard could not read its input, so it cannot judge the call.')
    process.exit(2)
  }
  const decision = decide({
    toolName: input?.tool_name,
    toolInput: input?.tool_input,
    cwd: typeof input?.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd()
  })
  if (decision.block) {
    console.error(decision.reason)
    process.exit(2)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
