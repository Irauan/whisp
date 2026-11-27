import type { AgentUpdate } from '../../../building-blocks/agent.port'
import { noticeOfModeChange } from '../entry'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'

export interface RecordAgentUpdateDeps {
  transcript: Transcript
  /** The saved sessions. The row holds the mode that Aether asked for. */
  store: SessionStore
}

/**
 * The event consumer of the progress of an agent (architecture, example slice, step 5). It saves
 * one update in the conversation of the session and tells the renderer. It is not a use case of
 * the renderer, so it has no contract and no controller. The composition root connects the agent
 * process of each session to it.
 */
export function recordAgentUpdateHandler({ transcript, store }: RecordAgentUpdateDeps, input: { sessionId: string; update: AgentUpdate }): void {
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
    case 'mode': {
      // Aether asked for the mode of the row. A report of another mode is a notice only for the
      // fallback of Auto (decision 0012, item 2).
      const asked = store.find(sessionId)?.mode
      const notice = asked === undefined ? null : noticeOfModeChange(asked, update.mode)
      if (notice) transcript.addEntry(sessionId, notice)
      return
    }
  }
}
