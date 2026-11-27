import { err, ok, type Result } from '../../../building-blocks/result'
import { isDraft, type EntryView, type SessionStatus } from '../entry'
import { MESSAGES, type Session } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { OpenSessionError } from './open.contract'

export interface OpenSessionDeps {
  store: SessionStore
  transcript: Transcript
}

export interface OpenedSession {
  session: Session
  entries: EntryView[]
  status: SessionStatus
  revision: number
  draft: boolean
}

export function openSessionHandler({ store, transcript }: OpenSessionDeps, { id }: { id: string }): Result<OpenedSession, OpenSessionError> {
  const session = store.find(id)
  if (!session) return err('unknown-session', MESSAGES.unknownSession)
  const { entries, status, revision } = transcript.snapshot(id)
  const agentSessionId = store.agentRunOf(id)?.externalId ?? null
  return ok({ session, entries, status, revision, draft: isDraft({ entryCount: entries.length, agentSessionId, status }) })
}
