// The test side of the simulated agent: a control server on a Windows named pipe.
//
//   const control = await ControlServer.start()
//   // Register the agent where the product finds it, for example in agents.json:
//   //   { id: 'simulated', name: 'Simulated', command: control.agent.command, args: control.agent.args }
//   await control.scenario('text', { gate: 'reply' })
//   ...start a turn...
//   await control.waitForMessage('session/prompt')
//   await control.open('reply')
//   await control.close()
//
// The test waits on a gate or on a message that the agent reports. It never sleeps.
//
// The wait rule: each report is kept until one wait takes it, and no wait takes it twice.
//   - A wait takes the oldest kept report that matches. This includes a report that came before
//     the wait started, so a test can wait after the agent already reached the gate.
//   - A report that no wait took stays kept. A later wait for the same gate takes it, even when
//     it belongs to an earlier turn. Take each report that a turn makes, or use a gate name for
//     each turn, so that a later wait does not meet a stale report.
// Each agent process reports its process ID, its folder, its environment and its arguments when it connects.
// `pids`, `environments` and `processMessages` keep them, so a test can tell the processes apart.
// The protocol is described at the top of `agent.mjs`.
import { randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { resolveScenario, type scenarios } from './scenarios.mjs'

/** A JSON-RPC message that the client sent to the agent. */
export interface AcpMessage {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

export type ScenarioName = keyof typeof scenarios

/** The start of one agent process: its process ID, its folder, its environment and its arguments. */
export interface AgentEnvironment {
  pid: number
  cwd: string
  env: Record<string, string>
  /** The arguments after the script of the agent: the pipe name, then any argument that the client added. */
  args: string[]
}

/** An ACP message and the process ID of the agent that received it. */
export interface ProcessMessage {
  pid: number
  message: AcpMessage
}

/** What the agent reports on the control pipe. */
export type AgentEvent =
  | { type: 'hello'; pid: number }
  | ({ type: 'environment' } & AgentEnvironment)
  | { type: 'message'; message: AcpMessage }
  | { type: 'gate'; name: string; state: 'waiting' | 'passed' }
  | { type: 'exit'; code: number }
  /** The control server adds this when the agent closes its pipe. The pid is absent when no hello came. */
  | { type: 'closed'; pid?: number }

interface Connection {
  socket: Socket
  /** True after the agent said hello and got its start message. */
  started: boolean
  /** The process ID from the hello of the agent. */
  pid?: number
  acks: Map<number, { resolve(): void; reject(error: Error): void }>
}

/**
 * Events that no wait has taken yet, and the waits for events that have not come.
 * See the wait rule at the top of this file.
 */
class Inbox {
  private readonly events: AgentEvent[] = []
  private readonly waits: { match(event: AgentEvent): boolean; resolve(event: AgentEvent): void }[] = []

  push(event: AgentEvent): void {
    const index = this.waits.findIndex((wait) => wait.match(event))
    if (index >= 0) this.waits.splice(index, 1)[0]!.resolve(event)
    else this.events.push(event)
  }

  /** Takes the oldest event that matches. Waits for it when none has come. */
  take(match: (event: AgentEvent) => boolean): Promise<AgentEvent> {
    const index = this.events.findIndex(match)
    if (index >= 0) return Promise.resolve(this.events.splice(index, 1)[0]!)
    return new Promise((resolve) => this.waits.push({ match, resolve }))
  }
}

export class ControlServer {
  /** Every ACP message that agents received, in the order of their reports. */
  readonly messages: AcpMessage[] = []
  /** The same messages, each with the process ID of the agent that received it. */
  readonly processMessages: ProcessMessage[] = []
  /** The process ID of each agent that connected, in the order of their hello. */
  readonly pids: number[] = []
  /** The start of each agent process, in the order of their reports. */
  readonly environments: AgentEnvironment[] = []

  private chosen: { name: string; options: Record<string, unknown> } = { name: 'text', options: {} }
  private readonly opened = new Set<string>()
  private readonly connections = new Set<Connection>()
  private readonly inbox = new Inbox()
  private nextCommand = 0

  private constructor(
    readonly pipeName: string,
    private readonly server: Server
  ) {}

  /** Starts a server on a new pipe. The name is unique for each call. */
  static async start(): Promise<ControlServer> {
    const pipeName = `\\\\.\\pipe\\aether-simulated-agent-${process.pid}-${randomUUID()}`
    const server = createServer()
    const control = new ControlServer(pipeName, server)
    server.on('connection', (socket) => control.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(pipeName, () => {
        server.off('error', reject)
        resolve()
      })
    })
    return control
  }

  /** The program and arguments that start the agent. Put them in `agents.json`. */
  get agent(): { command: string; args: string[] } {
    return { command: process.execPath, args: [join(__dirname, 'agent.mjs'), this.pipeName] }
  }

  /**
   * Chooses the scenario for the next requests. It applies to the agents that run and to the
   * agents that start later. Resolves when every running agent took it.
   */
  async scenario(name: ScenarioName, options: Record<string, unknown> = {}): Promise<void> {
    resolveScenario(name, options) // Fail here, not in the agent, on a wrong name.
    this.chosen = { name, options }
    await this.command((id) => ({ type: 'scenario', id, name, options }))
  }

  /** Opens a gate for good. Resolves when every running agent took it. */
  async open(gate: string): Promise<void> {
    this.opened.add(gate)
    await this.command((id) => ({ type: 'open', id, gate }))
  }

  /** Waits for the next ACP message of a method that no wait took yet. */
  async waitForMessage(method: string): Promise<AcpMessage> {
    const event = await this.inbox.take((e) => e.type === 'message' && e.message.method === method)
    return (event as Extract<AgentEvent, { type: 'message' }>).message
  }

  /** Waits until an agent stops at the gate. The agent reports it before it waits. */
  async waitForGate(name: string): Promise<void> {
    await this.inbox.take((e) => e.type === 'gate' && e.name === name && e.state === 'waiting')
  }

  /** Waits until an agent passed the gate. */
  async waitForGatePassed(name: string): Promise<void> {
    await this.inbox.take((e) => e.type === 'gate' && e.name === name && e.state === 'passed')
  }

  /** Waits until an agent connects to the pipe. Use it to see a new process start. Returns its process ID. */
  async waitForAgent(): Promise<number> {
    const event = await this.inbox.take((e) => e.type === 'hello')
    return (event as Extract<AgentEvent, { type: 'hello' }>).pid
  }

  /** Waits for the next start report of an agent process: its process ID, its folder, its environment and its arguments. */
  async waitForEnvironment(): Promise<AgentEnvironment> {
    const { type: _type, ...start } = (await this.inbox.take((e) => e.type === 'environment')) as Extract<
      AgentEvent,
      { type: 'environment' }
    >
    return start
  }

  /** Waits until an agent closes its pipe, for example after its process ends. Returns its process ID, if it said hello. */
  async waitForClose(): Promise<number | undefined> {
    const event = await this.inbox.take((e) => e.type === 'closed')
    return (event as Extract<AgentEvent, { type: 'closed' }>).pid
  }

  /** The ACP messages of one method that agents received so far. */
  received(method: string): AcpMessage[] {
    return this.messages.filter((message) => message.method === method)
  }

  /** The ACP messages of one method that agents received so far, each with the process ID of its agent. */
  receivedBy(method: string): ProcessMessage[] {
    return this.processMessages.filter(({ message }) => message.method === method)
  }

  async close(): Promise<void> {
    for (const connection of this.connections) connection.socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private accept(socket: Socket): void {
    const connection: Connection = { socket, started: false, acks: new Map() }
    this.connections.add(connection)
    socket.setEncoding('utf8')
    let pending = ''
    socket.on('data', (text: string) => {
      pending += text
      for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (line) this.receive(connection, JSON.parse(line) as AgentEvent | { type: 'ack'; id: number; error?: string })
      }
    })
    // A closed pipe can leave with an error. The close event follows in both cases.
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.connections.delete(connection)
      for (const ack of connection.acks.values()) ack.resolve()
      connection.acks.clear()
      this.inbox.push(connection.pid === undefined ? { type: 'closed' } : { type: 'closed', pid: connection.pid })
    })
  }

  private receive(connection: Connection, event: AgentEvent | { type: 'ack'; id: number; error?: string }): void {
    if (event.type === 'ack') {
      const ack = connection.acks.get(event.id)
      connection.acks.delete(event.id)
      if (event.error) ack?.reject(new Error(event.error))
      else ack?.resolve()
      return
    }
    if (event.type === 'hello') {
      // The agent handles no request before this message, so it has the scenario in time.
      connection.started = true
      connection.pid = event.pid
      this.pids.push(event.pid)
      this.write(connection, { type: 'start', scenario: this.chosen, opened: [...this.opened] })
    }
    if (event.type === 'environment') this.environments.push({ pid: event.pid, cwd: event.cwd, env: event.env, args: event.args })
    if (event.type === 'message') {
      this.messages.push(event.message)
      // A message comes after the hello of its agent, so the pid is known. A bare test socket may skip the hello.
      this.processMessages.push({ pid: connection.pid ?? -1, message: event.message })
    }
    this.inbox.push(event)
  }

  private write(connection: Connection, message: object): void {
    connection.socket.write(`${JSON.stringify(message)}\n`)
  }

  /** Sends a command to each running agent and waits for the acknowledgements. */
  private async command(build: (id: number) => object): Promise<void> {
    const waits: Promise<void>[] = []
    for (const connection of this.connections) {
      if (!connection.started) continue // It gets the state in its start message.
      const id = ++this.nextCommand
      waits.push(
        new Promise<void>((resolve, reject) => {
          connection.acks.set(id, { resolve, reject })
          this.write(connection, build(id))
        })
      )
    }
    await Promise.all(waits)
  }
}
