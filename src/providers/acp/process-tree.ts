import { execFile } from 'node:child_process'
import { join } from 'node:path'

/**
 * The process tree of an agent (spec S9, open choice 6, A). A child of the agent can outlive it, for
 * example a background command of Claude. It has the environment of the agent, with `GH_TOKEN`. On
 * Windows `taskkill /T` cannot find the children of a process that already ended. So Aether lists the
 * tree while the agent still runs, and ends each listed process that still runs after the agent ended.
 *
 * Known limits, recorded in `docs/architecture.md`: a crash of the agent, and a child that starts after the
 * list, still let a child escape. A list that fails makes the close end the whole tree with `taskkill /T /F`.
 * The list needs PowerShell. It takes about 0.7 to 1 s on a developer machine, and more on a loaded one.
 */

/** One process. `started` is the start time of the process, to tell it from a later process with the same number. */
export interface ProcessRow {
  pid: number
  parent: number
  /** The start time in 100 ns ticks (the Windows file time, UTC). It needs 64 bits. */
  started: bigint
}

export type Log = (message: string, cause?: unknown) => void

/** What a PowerShell call gives. A failure holds only the error code, the signal and the killed flag, never the output. */
export type PowershellResult = { ok: true; stdout: string } | { ok: false; detail: string }

/** Runs a PowerShell script. A test passes its own runner to fail the call. It never rejects. */
export type Powershell = (script: string) => Promise<PowershellResult>

/** What the list and the kill need from the caller. */
export interface TreeTools {
  log: Log
  run?: Powershell
}

/** The longest time that a PowerShell call or a `taskkill` call gets, in ms. A close never waits longer for it. */
export const TOOL_LIMIT_MS = 5000

/** The slack for the clocks when the start time of the agent is compared, in ms. */
const START_SLACK_MS = 2000

/** The file time (100 ns ticks since 1601) of the Unix epoch. */
const EPOCH_TICKS = 116_444_736_000_000_000n

/** The path of a program in `System32`. Aether never finds it through `PATH`. */
export function system32(...parts: string[]): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', ...parts)
}

/** The Unix time in ms of a Windows file time. */
export function startedAtMs(started: bigint): number {
  return Number((started - EPOCH_TICKS) / 10_000n)
}

const LIST_SCRIPT =
  "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Where-Object { $_.CreationDate } | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc() }"

/** Reads the lines `pid parent started`. A line that is not three whole numbers is skipped. */
export function parseRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^(\d+) (\d+) (\d+)$/.exec(line.trim())
    if (match) rows.push({ pid: Number(match[1]), parent: Number(match[2]), started: BigInt(match[3] ?? '0') })
  }
  return rows
}

/**
 * The processes below the root, at any depth: its children, their children and so on. The root is
 * not in the answer. A process counts as a child only when it started at or after its parent, so a
 * process that names a parent number that was reused later does not count.
 */
export function descendantsOf(rootPid: number, rows: readonly ProcessRow[]): ProcessRow[] {
  const root = rows.find((candidate) => candidate.pid === rootPid)
  if (!root) return []
  const found = new Map<number, ProcessRow>()
  const queue: ProcessRow[] = [root]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const candidate of rows) {
      if (candidate.parent !== next.pid || candidate.started < next.started) continue
      if (candidate.pid === rootPid || found.has(candidate.pid)) continue
      found.set(candidate.pid, candidate)
      queue.push(candidate)
    }
  }
  return [...found.values()]
}

/** Runs a PowerShell script by its full path in `System32`, with a time limit. It never rejects. */
export const runPowershell: Powershell = (script) =>
  new Promise((resolve) => {
    execFile(
      system32('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: TOOL_LIMIT_MS, maxBuffer: 1 << 24 },
      (error, stdout) => {
        if (!error) return resolve({ ok: true, stdout })
        const { code, signal, killed } = error
        resolve({ ok: false, detail: `code ${String(code)}, signal ${String(signal)}, killed ${String(killed)}` })
      }
    )
  })

/** Whether a process with this number runs. Signal 0 only checks it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The times, in Unix ms, between which the process of the agent started: the call of `spawn` and its `spawn` event. */
export interface StartWindow {
  from: number
  to: number
}

const FORCED = 'Aether ends the agent and its whole tree with taskkill instead.'

/**
 * The processes below the root now. Call it while the root still runs: a child of an ended process
 * has no parent to find. It checks that the root started inside the window, so a number that another
 * process reused gives no list. It gives an empty list on a system other than Windows.
 *
 * A failure gives null, and it is logged (four cases: the call failed or timed out, no row could be
 * read, the root is missing, the root started outside the window). User decision 2026-11-27: the
 * caller then ends the agent and its whole tree with `taskkill /T /F`, while the root still runs.
 */
export async function processTree(rootPid: number, window: StartWindow, { log, run = runPowershell }: TreeTools): Promise<ProcessRow[] | null> {
  if (process.platform !== 'win32') return []
  const listed = await run(LIST_SCRIPT)
  if (!listed.ok) {
    log(`Aether could not list the processes of the agent (${listed.detail}). ${FORCED}`)
    return null
  }
  const rows = parseRows(listed.stdout)
  if (rows.length === 0) {
    log(`Aether could not read the list of processes. ${FORCED}`)
    return null
  }
  const root = rows.find((candidate) => candidate.pid === rootPid)
  if (!root) {
    log(`The process of the agent is not in the list of processes. ${FORCED}`)
    return null
  }
  const at = startedAtMs(root.started)
  if (at < window.from - START_SLACK_MS || at > window.to + START_SLACK_MS) {
    log(`The process ${rootPid} did not start when the agent started, so the list is not the tree of the agent. ${FORCED}`)
    return null
  }
  return descendantsOf(rootPid, rows)
}

/**
 * Ends each listed process that still runs. It checks the start time of each one first, so a process
 * that got a number of an ended one is safe. It makes no call when no listed number runs. It never
 * rejects. A failed call is logged.
 */
export async function endSurvivors(list: readonly ProcessRow[], { log, run = runPowershell }: TreeTools): Promise<void> {
  if (process.platform !== 'win32') return
  const running = list.filter(({ pid }) => isRunning(pid))
  if (running.length === 0) return
  // The numbers come from `parseRows`, so the script holds digits only.
  const wanted = running.map(({ pid, started }) => `${pid}=${started}`).join(';')
  const ended = await run(
    `$wanted = @{${wanted}}; ` +
      'Get-CimInstance Win32_Process -Property ProcessId,CreationDate | ' +
      'Where-Object { $wanted.ContainsKey([int]$_.ProcessId) -and $_.CreationDate.ToFileTimeUtc() -eq $wanted[[int]$_.ProcessId] } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  )
  if (!ended.ok) log(`Aether could not end the child processes of the agent (${ended.detail}). They can keep running.`)
}
