// Tests of the wait rule of the control server. A bare socket plays the agent, so the order of
// the reports is exact. The tests wait on reports, never on a clock.
import { connect, type Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ControlServer } from './control'

let control: ControlServer
let agent: Socket

const report = (event: object) => agent.write(`${JSON.stringify(event)}\n`)
const waiting = (name: string) => report({ type: 'gate', name, state: 'waiting' })

/** Resolves after the server handled every report that was written before this call. */
const handled = async () => {
  report({ type: 'hello', pid: 0 })
  await control.waitForAgent()
}

beforeEach(async () => {
  control = await ControlServer.start()
  agent = connect(control.pipeName)
  await new Promise<void>((resolve) => agent.once('connect', () => resolve()))
})

afterEach(async () => {
  agent.destroy()
  await control.close()
})

describe('ControlServer wait rule', () => {
  it('gives an event that came before the wait started', async () => {
    waiting('reply')
    await handled()
    await control.waitForGate('reply')
  })

  it('gives each event once, oldest first', async () => {
    waiting('reply')
    await handled()
    await control.waitForGate('reply')

    // The first report is used up. A second wait for the same gate needs a second report.
    let settled = false
    const second = control.waitForGate('reply').then(() => {
      settled = true
    })
    await handled()
    expect(settled).toBe(false)
    waiting('reply')
    await second
  })

  it('keeps the events of other gates and of other states apart', async () => {
    waiting('other')
    report({ type: 'gate', name: 'reply', state: 'passed' })
    await handled()
    let settled = false
    const wait = control.waitForGate('reply').then(() => {
      settled = true
    })
    await handled()
    expect(settled).toBe(false)
    // The earlier reports stay for their own waits.
    await control.waitForGate('other')
    await control.waitForGatePassed('reply')
    waiting('reply')
    await wait
  })
})
