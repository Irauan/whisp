import { execFile } from 'node:child_process'

/**
 * The process tree of an agent (spec S9, open choice 6, A). A child of the agent can outlive it, for
 * example a background command of Claude. It has the environment of the agent, with `GH_TOKEN`. On
 * Windows `taskkill /T` cannot find the children of a process that already ended. So Aether lists the
 * tree while the agent still runs, and ends each listed process that still runs after the agent ended.
 *
 * Known limits, recorded in `docs/architecture.md`: a crash of the agent, and a child that starts after
 * the list, still escape. The list needs PowerShell and takes some hundreds of milliseconds.
 */

/** One process. `started` is the start time of the process, to tell it from a later process with the same number. */
export interface ProcessRow {
  pid: number
  parent: number
  /** The start time in 100 ns ticks (the Windows file time). It needs 64 bits. */
  started: bigint
}

/** The longest time that a PowerShell call gets, in ms. A close never waits longer for the tree. */
const POWERSHELL_LIMIT_MS = 15_000

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

/** Runs a PowerShell script. It never rejects: a failure gives an empty text. */
function powershell(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: POWERSHELL_LIMIT_MS, maxBuffer: 1 << 24 },
      (error, stdout) => resolve(error ? '' : stdout)
    )
  })
}

/** Whether a process with this number runs. Signal 0 only checks it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The processes below the root now. Call it while the root still runs: a child of an ended process
 * has no parent to find. It gives an empty list on a system other than Windows, and when the call fails.
 */
export async function processTree(rootPid: number): Promise<ProcessRow[]> {
  if (process.platform !== 'win32') return []
  return descendantsOf(rootPid, parseRows(await powershell(LIST_SCRIPT)))
}

/**
 * Ends each listed process that still runs. It checks the start time of each one first, so a process
 * that got a number of an ended one is safe. It makes no call when no listed number runs. It never rejects.
 */
export async function endSurvivors(list: readonly ProcessRow[]): Promise<void> {
  if (process.platform !== 'win32') return
  const running = list.filter(({ pid }) => isRunning(pid))
  if (running.length === 0) return
  // The numbers come from `parseRows`, so the script holds digits only.
  const wanted = running.map(({ pid, started }) => `${pid}=${started}`).join(';')
  await powershell(
    `$wanted = @{${wanted}}; ` +
      'Get-CimInstance Win32_Process -Property ProcessId,CreationDate | ' +
      'Where-Object { $wanted.ContainsKey([int]$_.ProcessId) -and $_.CreationDate.ToFileTimeUtc() -eq $wanted[[int]$_.ProcessId] } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  )
}
