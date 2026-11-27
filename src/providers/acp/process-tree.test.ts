import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  descendantsOf,
  endSurvivors,
  isRunning,
  parseRows,
  processTree,
  runPowershell,
  startedAtMs,
  system32,
  type Powershell,
  type ProcessRow,
  type StartWindow,
  type TreeTools
} from './process-tree'

const row = (pid: number, parent: number, started: number | bigint): ProcessRow => ({ pid, parent, started: BigInt(started) })

describe('parseRows', () => {
  it('reads one process for each line, and skips a line that is not three whole numbers', () => {
    const text = ['10 1 133000000000000001', '', 'garbage', '11 10 133000000000000002\r', '12 10', '13 x 5', '14 10 133000000000000003 extra'].join('\n')
    expect(parseRows(text)).toEqual([row(10, 1, 133000000000000001n), row(11, 10, 133000000000000002n)])
  })

  it('keeps all digits of a time that a double cannot hold', () => {
    expect(parseRows('10 1 133000000000000001')[0]?.started).toBe(133000000000000001n)
  })
})

describe('descendantsOf', () => {
  it('finds children, grandchildren and a child that outlives its parent, but not the root, a sibling or a stranger', () => {
    const rows = [row(1, 0, 10), row(100, 1, 20), row(101, 100, 30), row(102, 101, 40), row(103, 100, 31), row(200, 1, 21), row(201, 200, 32)]
    expect(descendantsOf(100, rows).map((process) => process.pid).sort()).toEqual([101, 102, 103])
  })

  it('returns nothing when the root is not in the list, and nothing for a root with no children', () => {
    expect(descendantsOf(5, [row(1, 0, 10)])).toEqual([])
    expect(descendantsOf(1, [row(1, 0, 10)])).toEqual([])
  })

  it('skips a process that names the root as its parent but started before it: the number of the parent was reused', () => {
    const rows = [row(100, 1, 50), row(101, 100, 60), row(102, 100, 40)]
    expect(descendantsOf(100, rows).map((process) => process.pid)).toEqual([101])
  })

  it('ends on a loop of parents', () => {
    const rows = [row(100, 101, 10), row(101, 100, 10)]
    expect(descendantsOf(100, rows).map((process) => process.pid)).toEqual([101])
  })
})

const EPOCH_TICKS = 116_444_736_000_000_000n
const ticksOf = (ms: number) => BigInt(ms) * 10_000n + EPOCH_TICKS

describe('startedAtMs and system32', () => {
  it('turns a Windows file time into the Unix time in ms, in UTC', () => {
    const ms = Date.UTC(2026, 0, 1, 12, 30, 15, 250)
    expect(startedAtMs(ticksOf(ms))).toBe(ms)
    expect(startedAtMs(EPOCH_TICKS)).toBe(0)
  })

  it('gives the path of a program in System32 from SystemRoot', () => {
    const saved = process.env.SystemRoot
    try {
      process.env.SystemRoot = 'C:\\Fake'
      expect(system32('taskkill.exe').replaceAll('\\', '/')).toBe('C:/Fake/System32/taskkill.exe')
    } finally {
      if (saved === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = saved
    }
  })
})

const children: ChildProcess[] = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

/** A child that waits until it is killed. */
function wait(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore', windowsHide: true, detached: true })
  children.push(child)
  return child
}

const spawned = (child: ChildProcess) => new Promise<void>((resolve) => child.once('spawn', resolve))

/** Waits until the process ended. A poll with a time limit, no sleep. */
async function ended(pid: number): Promise<boolean> {
  const limit = Date.now() + 5000
  while (isRunning(pid) && Date.now() < limit) await new Promise((resolve) => setImmediate(resolve))
  return !isRunning(pid)
}

/** The window in which this test process started: its uptime gives the start. */
const ownStart = (): StartWindow => {
  const start = Date.now() - process.uptime() * 1000
  return { from: start - 3000, to: start + 3000 }
}

/** The text that the list script writes for the rows. */
const listing = (rows: ProcessRow[]) => rows.map((entry) => `${entry.pid} ${entry.parent} ${entry.started}`).join('\n')

/** A runner that gives the text, or fails when the text is null. It records the scripts that it ran. */
function tools(answer: string | null): TreeTools & { logged: string[]; scripts: string[] } {
  const logged: string[] = []
  const scripts: string[] = []
  const run: Powershell = (script) => {
    scripts.push(script)
    return Promise.resolve(answer === null ? { ok: false, detail: 'code 1, signal null, killed false' } : { ok: true, stdout: answer })
  }
  return { log: (message) => logged.push(message), run, logged, scripts }
}

/** A log that a test does not expect to be called. */
const fail = (message: string): void => {
  throw new Error(`Unexpected log: ${message}`)
}

// The listing uses PowerShell, so these tests run on Windows only (architecture: Windows 11).
describe.runIf(process.platform === 'win32')('processTree and endSurvivors, the failures (S1)', () => {
  const window: StartWindow = { from: 1_000_000, to: 1_000_100 }
  const root = (at: number) => ({ pid: 100, parent: 1, started: ticksOf(at) })
  const child = { pid: 101, parent: 100, started: ticksOf(1_000_500) }

  it('gives the children of the root when it started inside the window', async () => {
    const t = tools(listing([root(1_000_050), child]))
    expect(await processTree(100, window, t)).toEqual([child])
    expect(t.logged).toEqual([])
  })

  it('logs a call that failed or timed out, gives no list, and names the error code and no output', async () => {
    const t = tools(null)
    expect(await processTree(100, window, t)).toEqual([])
    expect(t.logged).toHaveLength(1)
    expect(t.logged[0]).toMatch(/could not list the processes.*code 1, signal null, killed false.*outlive/)
  })

  it('logs a list with no row that it can read, and never the text of the output', async () => {
    const t = tools('Get-CimInstance : Access denied\ngarbage')
    expect(await processTree(100, window, t)).toEqual([])
    expect(t.logged).toHaveLength(1)
    expect(t.logged[0]).toMatch(/could not read the list/)
    expect(t.logged[0]).not.toContain('Access denied')
  })

  it('logs a root that is not in the list', async () => {
    const t = tools(listing([{ pid: 7, parent: 1, started: ticksOf(1_000_050) }]))
    expect(await processTree(100, window, t)).toEqual([])
    expect(t.logged[0]).toMatch(/not in the list/)
  })

  it('logs a root that started before the window or after it: its number was reused', async () => {
    for (const at of [window.from - 60_000, window.to + 60_000]) {
      const t = tools(listing([root(at), child]))
      expect(await processTree(100, window, t)).toEqual([])
      expect(t.logged[0]).toMatch(/did not start when the agent started/)
    }
  })

  it('accepts a root that started a little outside the window: the clocks have slack', async () => {
    const t = tools(listing([root(window.from - 500), child]))
    expect(await processTree(100, window, t)).toEqual([child])
  })

  it('makes no kill call when no listed process runs, and logs a failed kill call', async () => {
    const quiet = tools('')
    await endSurvivors([{ pid: 2_147_483_000, parent: 1, started: ticksOf(1) }], quiet)
    expect(quiet.scripts).toEqual([])
    const failing = tools(null)
    await endSurvivors([{ pid: process.pid, parent: 1, started: ticksOf(1) }], failing)
    expect(failing.scripts).toHaveLength(1)
    expect(failing.logged[0]).toMatch(/could not end the child processes.*code 1/)
  })

  it('fails with a code, and does not throw, when PowerShell is not where SystemRoot says', async () => {
    const saved = process.env.SystemRoot
    try {
      process.env.SystemRoot = 'C:\\this-folder-does-not-exist-aether'
      expect(await runPowershell('1')).toEqual({ ok: false, detail: expect.stringContaining('ENOENT') })
    } finally {
      if (saved === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = saved
    }
  }, 30_000)
})

describe.runIf(process.platform === 'win32')('processTree and endSurvivors (Windows, real processes)', () => {
  it('checks the start time of the root with the real clock, in any time zone: the test process started when its uptime says', async () => {
    await processTree(process.pid, ownStart(), { log: fail })
    // A window one hour away, as a wrong conversion would give, is refused.
    const hour = 3_600_000
    const { from, to } = ownStart()
    const logged: string[] = []
    const log = (message: string) => logged.push(message)
    await processTree(process.pid, { from: from + hour, to: to + hour }, { log })
    await processTree(process.pid, { from: from - hour, to: to - hour }, { log })
    expect(logged).toHaveLength(2)
  }, 30_000)

  it('lists the child of this process, with its start time, and ends it with endSurvivors', async () => {
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid, ownStart(), { log: fail })
    const found = tree.find((entry) => entry.pid === child.pid)
    expect(found, 'the child of this process is in its tree').toBeDefined()
    expect(found!.parent).toBe(process.pid)
    expect(isRunning(child.pid!)).toBe(true)

    // Only the row of the child: the tree of this process holds other children of the test runner.
    await endSurvivors([found!], { log: fail })
    expect(await ended(child.pid!)).toBe(true)
  }, 30_000)

  it('ends no process whose start time differs: the number was reused', async () => {
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid, ownStart(), { log: fail })
    const found = tree.find((entry) => entry.pid === child.pid)!
    await endSurvivors([{ ...found, started: found.started + 10_000_000n }], { log: fail })
    expect(isRunning(child.pid!)).toBe(true)
  }, 30_000)

  it('does nothing for a process that already ended, and for an empty list', async () => {
    await expect(endSurvivors([], { log: fail })).resolves.toBeUndefined()
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid, ownStart(), { log: fail })
    child.kill()
    expect(await ended(child.pid!)).toBe(true)
    await expect(
      endSurvivors(
        tree.filter((entry) => entry.pid === child.pid),
        { log: fail }
      )
    ).resolves.toBeUndefined()
  }, 30_000)

  it('logs a process that does not exist, and gives an empty list', async () => {
    const logged: string[] = []
    expect(await processTree(2_147_483_000, ownStart(), { log: (message) => logged.push(message) })).toEqual([])
    expect(logged).toHaveLength(1)
  }, 30_000)
})
