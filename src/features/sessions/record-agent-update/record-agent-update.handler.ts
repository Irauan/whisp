import type { AgentUpdate } from '../../../building-blocks/agent.port'
import type { Transcript } from '../transcript.store'

export interface RecordAgentUpdateDeps {
  transcript: Transcript
}

/**
 * The event consumer of the progress of an agent (architecture, example slice, step 5). It saves
 * one update in the conversation of the session and tells the renderer. It is not a use case of
 * the renderer, so it has no contract and no controller. The composition root connects the agent
 * process of each session to it.
 */
export function recordAgentUpdateHandler({ transcript }: RecordAgentUpdateDeps, input: { sessionId: string; update: AgentUpdate }): void {
  const { sessionId, update } = input
  switch (update.type) {
    case 'text':
      transcript.addText(sessionId, 'agent', update.text)
      return
    case 'thought':
      transcript.addText(sessionId, 'thought', update.text)
      return
    case 'tool':
      transcript.announceTool(sessionId, update)
      return
    case 'tool-update':
      transcript.updateTool(sessionId, update)
      return
    case 'plan':
      transcript.addPlan(sessionId, update)
      return
  }
}
