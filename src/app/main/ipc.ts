import type { Contract } from '../../building-blocks/contract'
import { err, ok, type Result } from '../../building-blocks/result'
import { EVENT_CHANNEL } from '../../shared/channels'

/** The part of an Electron IPC event that this file reads. */
export interface SenderEvent {
  sender: { id: number; send(channel: string, ...args: unknown[]): void; isDestroyed(): boolean }
}

export type Controller = (input: never) => Promise<unknown>

export interface InvokeDeps<Event extends SenderEvent> {
  /** The registry of contracts. */
  contracts: readonly Contract[]
  /** The controller of each contract, by name. */
  controllers: Readonly<Record<string, Controller>>
  /** True only for the main frame of a window that Aether created, with its own page. */
  isTrusted(event: Event): boolean
  log(message: string, cause?: unknown): void
}

const DEFECT = 'Something went wrong.'

/**
 * The handler of `invoke(name, input)`. It checks the sender, finds the name in the registry,
 * parses the input, runs the controller and checks the result. It runs no controller before
 * each check passes. A thrown error is a defect: it is logged and the caller sees a generic message.
 */
export function createInvoke<Event extends SenderEvent>({ contracts, controllers, isTrusted, log }: InvokeDeps<Event>) {
  const byName = new Map(contracts.map((contract) => [contract.name, contract]))
  const controllerOf = new Map(Object.entries(controllers))
  return async (event: Event, name: unknown, input: unknown): Promise<Result<unknown>> => {
    if (!isTrusted(event)) return err('forbidden', 'This sender cannot call the main process.')
    const contract = typeof name === 'string' ? byName.get(name) : undefined
    if (!contract) return err('unknown-contract', 'There is no contract with this name.')
    const parsed = contract.input.safeParse(input)
    if (!parsed.success) return err('invalid-input', 'The input does not match the contract.')
    try {
      const controller = controllerOf.get(contract.name)
      if (!controller) throw new Error(`The contract ${contract.name} has no controller.`)
      const result = await controller(parsed.data as never)
      const checked = contract.output.safeParse(result)
      if (!checked.success) throw new Error(`The result of ${contract.name} does not match its contract.`)
      return checked.data
    } catch (cause) {
      log(`The handler of ${contract.name} failed.`, cause)
      return err('defect', DEFECT)
    }
  }
}

export interface SubscribeDeps<Event extends SenderEvent> {
  /** The names of the events that a renderer can subscribe to. */
  events: readonly string[]
  isTrusted(event: Event): boolean
}

/** The handler of `subscribe(name)`, and the function that sends an event to the subscribers of a name. */
export function createSubscribe<Event extends SenderEvent>({ events, isTrusted }: SubscribeDeps<Event>) {
  const known = new Set(events)
  const subscribers = new Map<string, Map<number, SenderEvent['sender']>>()
  return {
    handler(event: Event, name: unknown): Result<null> {
      if (!isTrusted(event)) return err('forbidden', 'This sender cannot call the main process.')
      if (typeof name !== 'string' || !known.has(name)) return err('unknown-contract', 'There is no event with this name.')
      const senders = subscribers.get(name) ?? new Map()
      senders.set(event.sender.id, event.sender)
      subscribers.set(name, senders)
      return ok(null)
    },
    publish(name: string, payload: unknown): void {
      for (const [id, sender] of subscribers.get(name) ?? []) {
        if (sender.isDestroyed()) subscribers.get(name)?.delete(id)
        else sender.send(EVENT_CHANNEL, name, payload)
      }
    }
  }
}
