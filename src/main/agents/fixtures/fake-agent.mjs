// A small ACP agent for tests. What it does depends on the prompt:
// "hello" streams text, "edit" asks permission for a tool call,
// "auth" says nobody is signed in, and "wait" runs until it is cancelled.
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'

let next = 0
const waiting = new Map()

const app = agent({ name: 'fake' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { sessionCapabilities: { resume: {} } },
    authMethods: []
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: `s${++next}` }))
  .onRequest(methods.agent.session.resume, ({ params }) => {
    if (!params.sessionId.startsWith('s')) throw RequestError.invalidParams(undefined, 'Unknown session')
    return {}
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => waiting.get(params.sessionId)?.())
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const { sessionId } = params
    const text = params.prompt.map((block) => block.text ?? '').join('')
    const update = (value) => client.notify(methods.client.session.update, { sessionId, update: value })
    const say = (words) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: words } })

    if (text === 'auth') throw new RequestError(-32000, 'Authentication required')
    if (text === 'wait') {
      await new Promise((resolve) => waiting.set(sessionId, resolve))
      return { stopReason: 'cancelled' }
    }
    if (text === 'edit') {
      await update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit README.md', kind: 'edit', status: 'pending' })
      const answer = await client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 't1' },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Refuse', kind: 'reject_once' }
        ]
      })
      const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes'
      await update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed' })
      await say(allowed ? 'Edited' : 'Skipped')
      return { stopReason: 'end_turn' }
    }
    await say('Hel')
    await say('lo')
    return { stopReason: 'end_turn' }
  })

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
