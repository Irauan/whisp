// The requests that the simulated agent sends to the client: permission requests and form
// elicitations (added for story S5 of milestone m1-chat).
//
// The steps of this file do not wait for the answers. A step sends its requests and returns, so a
// scenario can send several requests at the same time, withdraw one, end the process, or let the
// turn end while a request is open. The step `answers` waits for every open request of the session.
//
//   { do: 'ask', requests, withdrawOnCancel? }   for each request, in order: a `tool_call` update,
//                                                then `session/request_permission`. A request is
//                                                { id, title, kind?, locations?, options?, modes? }.
//                                                `id` is the toolCallId. `options` are ACP options
//                                                (default: "Allow" `yes` allow_once and "Refuse" `no`
//                                                reject_once). `modes` maps an optionId to a Claude
//                                                mode: when the client picks it, the agent uses that
//                                                mode and sends `current_mode_update`, as Claude
//                                                Code does after a plan exit.
//   { do: 'elicit', id, request, fallbackModel?, withdrawOnCancel? }
//                                                send `elicitation/create` with the parameters of
//                                                `request` (the session ID is added). With
//                                                `fallbackModel`, an `accept` with the choice
//                                                `retry_fallback` switches the model and sends
//                                                `config_option_update`, as Claude Code does after
//                                                the refusal fallback dialog.
//   { do: 'withdraw', id }                       withdraw the open request `id` with `$/cancel_request`
//   { do: 'answers' }                            wait until the client answered every open request.
//                                                The turn then ends as cancelled when the client
//                                                cancelled it meanwhile.
//   { do: 'detach', steps }                      run `steps` on their own, outside the turn, and go
//                                                on. The turn can end while they run. Start them
//                                                with a gate, so that the test chooses the moment.
//
// With `withdrawOnCancel`, a cancel of the turn also withdraws the open requests of the step, as
// the Claude Code adapter does when it gets `session/cancel`.
//
// The agent reports each answer on the control pipe, when it comes:
//   { type: 'permission', id, outcome }          the `outcome` of the answer, as ACP gives it
//   { type: 'permission', id, error }            the client answered with an error { code, message }
//   { type: 'elicitation', id, response }        the answer, for example { action: 'accept', content }
//   { type: 'elicitation', id, error }           the client answered with an error { code, message }
import { methods } from '@agentclientprotocol/sdk'

/** The options of a permission request when the step gives none. */
export const DEFAULT_OPTIONS = [
  { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
  { optionId: 'no', name: 'Refuse', kind: 'reject_once' }
]

/** The steps of this file. */
export const REQUEST_STEPS = new Set(['ask', 'elicit', 'withdraw', 'answers', 'detach'])

/** The open requests of each session: request id -> { controller, settled }. */
const openRequests = new Map()

function openOf(sessionId) {
  if (!openRequests.has(sessionId)) openRequests.set(sessionId, new Map())
  return openRequests.get(sessionId)
}

const errorOf = (error) => ({ code: error?.code ?? null, message: String(error?.message ?? error) })

/** A notification that cannot fail the step: the connection can be gone when an answer comes late. */
async function quietly(send) {
  try {
    await send()
  } catch {
    // The client is gone. The report of the answer was sent before.
  }
}

/** A controller that aborts when the turn is cancelled, if the step asks for it. */
function withdrawalOf(signal, withdrawOnCancel) {
  const controller = new AbortController()
  if (withdrawOnCancel) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller
}

/**
 * Runs one step of this file. `context` holds the turn signal, the session, the client and the
 * functions of the agent: `report`, `update`, `setMode(mode)`, `setModel(model)` (returns the
 * configuration options) and `runSteps`. Returns 'cancelled' when the turn ends as cancelled.
 */
export async function runRequestStep(step, context) {
  const { signal, sessionId, client, report, update } = context
  if (!client) throw new Error(`Step "${step.do}" needs a session.`)
  const open = openOf(sessionId)
  switch (step.do) {
    case 'ask': {
      for (const request of step.requests ?? []) {
        if (typeof request.id !== 'string') throw new Error('Each request of the step "ask" needs an `id`.')
        const options = request.options ?? DEFAULT_OPTIONS
        const locations = (request.locations ?? []).map((path) => ({ path }))
        const kind = request.kind ?? 'other'
        await update({
          sessionUpdate: 'tool_call',
          toolCallId: request.id,
          title: request.title,
          kind,
          status: 'pending',
          ...(locations.length > 0 ? { locations } : {})
        })
        const controller = withdrawalOf(signal, step.withdrawOnCancel)
        const sent = client.request(
          methods.client.session.requestPermission,
          {
            sessionId,
            toolCall: { toolCallId: request.id, title: request.title, kind, ...(locations.length > 0 ? { locations } : {}) },
            options
          },
          { cancellationSignal: controller.signal }
        )
        const settled = sent.then(
          async (answer) => {
            await report({ type: 'permission', id: request.id, outcome: answer.outcome })
            const chosen =
              answer.outcome?.outcome === 'selected' ? options.find((option) => option.optionId === answer.outcome.optionId) : undefined
            const allowed = typeof chosen?.kind === 'string' && chosen.kind.startsWith('allow')
            await quietly(() => update({ sessionUpdate: 'tool_call_update', toolCallId: request.id, status: allowed ? 'completed' : 'failed' }))
            const mode = chosen ? request.modes?.[chosen.optionId] : undefined
            if (mode) {
              context.setMode(mode)
              await quietly(() => update({ sessionUpdate: 'current_mode_update', currentModeId: mode }))
            }
          },
          (error) => report({ type: 'permission', id: request.id, error: errorOf(error) })
        )
        open.set(request.id, { controller, settled })
      }
      return undefined
    }
    case 'elicit': {
      if (typeof step.id !== 'string') throw new Error('The step "elicit" needs an `id`.')
      const controller = withdrawalOf(signal, step.withdrawOnCancel)
      const sent = client.request(methods.client.elicitation.create, { sessionId, ...step.request }, { cancellationSignal: controller.signal })
      const settled = sent.then(
        async (response) => {
          await report({ type: 'elicitation', id: step.id, response })
          if (step.fallbackModel && response?.action === 'accept' && response.content?.choice === 'retry_fallback') {
            const configOptions = context.setModel(step.fallbackModel)
            await quietly(() => update({ sessionUpdate: 'config_option_update', configOptions }))
          }
        },
        (error) => report({ type: 'elicitation', id: step.id, error: errorOf(error) })
      )
      open.set(step.id, { controller, settled })
      return undefined
    }
    case 'withdraw': {
      const request = open.get(step.id)
      if (!request) throw new Error(`No open request "${step.id}" to withdraw.`)
      request.controller.abort()
      return undefined
    }
    case 'answers': {
      const waiting = [...open.entries()]
      await Promise.all(waiting.map(([, request]) => request.settled))
      for (const [id, request] of waiting) if (open.get(id) === request) open.delete(id)
      return signal.aborted ? 'cancelled' : undefined
    }
    case 'detach': {
      const detached = new AbortController()
      void context.runSteps(step.steps ?? [], { signal: detached.signal, sessionId, client }).catch((error) => {
        process.stderr.write(`Detached steps failed: ${error?.message ?? error}\n`)
      })
      return undefined
    }
    default:
      throw new Error(`Unknown step "${step.do}".`)
  }
}
