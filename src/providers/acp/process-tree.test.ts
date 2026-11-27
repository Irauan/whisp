import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { descendantsOf, endSurvivors, isRunning, parseRows, processTree, type ProcessRow } from './process-tree'

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

// The listing uses PowerShell, so these tests run on Windows only (architecture: Windows 11).
describe.runIf(process.platform === 'win32')('processTree and endSurvivors (Windows)', () => {
  it('lists the child of this process, with its start time, and ends it with endSurvivors', async () => {
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid)
    const found = tree.find((entry) => entry.pid === child.pid)
    expect(found, 'the child of this process is in its tree').toBeDefined()
    expect(found!.parent).toBe(process.pid)
    expect(isRunning(child.pid!)).toBe(true)

    // Only the row of the child: the tree of this process holds other children of the test runner.
    await endSurvivors([found!])
    expect(await ended(child.pid!)).toBe(true)
  }, 30_000)

  it('ends no process whose start time differs: the number was reused', async () => {
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid)
    const found = tree.find((entry) => entry.pid === child.pid)!
    await endSurvivors([{ ...found, started: found.started + 10_000_000n }])
    expect(isRunning(child.pid!)).toBe(true)
  }, 30_000)

  it('does nothing for a process that already ended, and for an empty list', async () => {
    await expect(endSurvivors([])).resolves.toBeUndefined()
    const child = wait()
    await spawned(child)
    const tree = await processTree(process.pid)
    child.kill()
    expect(await ended(child.pid!)).toBe(true)
    await expect(endSurvivors(tree.filter((entry) => entry.pid === child.pid))).resolves.toBeUndefined()
  }, 30_000)

  it('gives an empty list for a process that does not exist', async () => {
    expect(await processTree(2_147_483_000)).toEqual([])
  }, 30_000)
})
