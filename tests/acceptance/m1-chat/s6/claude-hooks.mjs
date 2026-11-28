// The launcher of the S6 tests of milestone m1-chat: the simulated agent, with the session start of
// Claude Code that S6 guards.
//
// Decision 0007 records it: at session start, Claude runs the `SessionStart` hooks of a repository
// and starts its project MCP servers, without a question. The simulated agent of m0-gates does
// neither. Without this launcher, the check "the hook does not run" of A9 would pass for any app.
//
// Start it as the simulated agent, with the name of the control pipe:
//
//   node claude-hooks.mjs \\.\pipe\aether-simulated-agent-1234
//
// It starts `agent.mjs` as its child, with the same arguments. It passes the messages of the client
// to the child line by line. Before it passes a `session/new`, `session/resume` or `session/load`,
// it does what Claude does in the folder `cwd` of that request:
// - It runs each command hook of `SessionStart` in `.claude/settings.json`, through the shell.
// - It runs the command of each server in `.mcp.json`, and waits until it ends.
// The output of the child goes to the client unchanged. The launcher ends with the exit code of
// the child. It uses no timers.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const agentProgram = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'simulated-agent', 'agent.mjs')

/** The JSON of a file, or undefined when the file is missing or not JSON. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** The environment of a hook: the one of this process, with the folder of Node first on PATH. */
function hookEnvironment(folder) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: folder }
  const pathName = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathName] = `${dirname(process.execPath)};${env[pathName] ?? ''}`
  return env
}

/** Runs one command in the folder through the shell, and waits until it ends. */
function run(command, folder) {
  spawnSync(command, { cwd: folder, env: hookEnvironment(folder), shell: true, stdio: 'ignore', windowsHide: true })
}

/** Does what Claude does at the start of a session in the folder: hooks first, then MCP servers. */
function startSessionIn(folder) {
  const settings = readJson(join(folder, '.claude', 'settings.json'))
  const groups = settings?.hooks?.SessionStart
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
      if (hook?.type === 'command' && typeof hook.command === 'string') run(hook.command, folder)
    }
  }
  const servers = readJson(join(folder, '.mcp.json'))?.mcpServers
  for (const server of Object.values(servers ?? {})) {
    if (typeof server?.command !== 'string') continue
    const args = Array.isArray(server.args) ? server.args.map(String) : []
    run([server.command, ...args].join(' '), folder)
  }
}

const SESSION_STARTS = new Set(['session/new', 'session/resume', 'session/load'])

const child = spawn(process.execPath, [agentProgram, ...process.argv.slice(2)], {
  stdio: ['pipe', 'inherit', 'inherit'],
  windowsHide: true
})
child.on('exit', (code) => process.exit(code ?? 1))
child.stdin.on('error', () => undefined)

let pending = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (text) => {
  pending += text
  for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
    const line = pending.slice(0, end + 1)
    pending = pending.slice(end + 1)
    let message
    try {
      message = JSON.parse(line)
    } catch {
      message = undefined
    }
    const folder = message?.params?.cwd
    if (SESSION_STARTS.has(message?.method) && typeof folder === 'string') startSessionIn(folder)
    child.stdin.write(line)
  }
})
process.stdin.on('end', () => {
  if (pending) child.stdin.write(pending)
  child.stdin.end()
})
