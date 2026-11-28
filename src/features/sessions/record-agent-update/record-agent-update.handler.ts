import type { AgentUpdate } from '../../../building-blocks/agent.port'
import { closedWithout, type AgentRequestEvent } from '../cards'
import { noticeOfModeChange } from '../entry'
import { titleOf } from '../session'
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
      const saved = store.find(sessionId)?.mode
      if (saved === undefined) return
      const notice = noticeOfModeChange(saved, update.mode)
      if (notice) transcript.addEntry(sessionId, notice)
      // The window shows the mode that the agent uses. A report of the mode that it already shows changes nothing.
      if (update.mode === (transcript.liveModeOf(sessionId) ?? saved)) return
      // Spec S5, "Live mode": the agent's mode is saved, so that a new process starts in it. Approve all is
      // never saved, and neither is the mode of the fallback of Auto: the user chose Auto, so it stays saved.
      if (update.mode !== 'approve-all' && notice === null) store.setMode(sessionId, update.mode)
      transcript.setLiveMode(sessionId, update.mode)
      return
    }
    case 'model':
      // The agent moved the session to another model (the refusal fallback). The next process starts with it.
      store.setModel(sessionId, update.model)
      transcript.setModel(sessionId, update.model)
      return
    case 'title': {
      // Spec S10: clean first, then check for blank. A blank title, a title equal to the saved one, and a title
      // for a session that is gone change nothing. The store saves first: a failed save sends no event.
      const title = titleOf(update.title)
      const saved = store.find(sessionId)?.title
      if (title === '' || saved === undefined || title === saved) return
      // A title of the agent never replaces a title of the user: the store refuses it, so no event goes out.
      if (store.setTitle(sessionId, title, 'agent')) transcript.setTitle(sessionId, title)
      return
    }
  }
}

/**
 * The other event consumer of an agent: its permission requests and its forms. A request opens a card,
 * which saves its entry. A request that the agent withdrew, or that the process left open when it exited,
 * closes its card with that reason. The slice that starts a close (Stop, quit, delete) names its own reason.
 */
export function recordAgentRequestHandler({ transcript }: RecordAgentUpdateDeps, input: { sessionId: string; event: AgentRequestEvent }): void {
  const { sessionId, event } = input
  switch (event.type) {
    case 'permission':
      transcript.openPermission(sessionId, event.request)
      return
    case 'elicitation':
      transcript.openElicitation(sessionId, event.form)
      return
    case 'permission-closed':
    case 'elicitation-closed':
      transcript.closeCard(sessionId, event.id, (card) => closedWithout(card.entry, event.reason))
      return
  }
}
