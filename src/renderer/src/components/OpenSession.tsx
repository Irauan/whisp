import { SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openSession } from '../../../features/sessions/open/open.contract'
import { invokeContract } from '../invoke'
import type { SessionView } from '../useProfiles'
import { EmptyPage } from './Pages'
import { SessionPage } from './SessionPage'

type Opened = { status: 'opened'; session: SessionView } | { status: 'missing' } | { status: 'failed'; message: string }

/**
 * The window of one session. It opens the session through the slice `sessions.open`. The caller
 * gives it a `key` with the session ID, so that a new session starts with a new state.
 */
export function OpenSession({ id, onDelete }: { id: string; onDelete(): void }) {
  const [opened, setOpened] = useState<Opened | null>(null)

  useEffect(() => {
    let current = true
    void invokeContract(openSession, { id }).then((result) => {
      if (!current) return
      if (result.ok) setOpened({ status: 'opened', session: result.value.session })
      else if (result.error.code === 'unknown-session') setOpened({ status: 'missing' })
      else setOpened({ status: 'failed', message: result.error.message })
    })
    return () => {
      current = false
    }
  }, [id])

  if (!opened) return null
  if (opened.status === 'opened') return <SessionPage session={opened.session} onDelete={onDelete} />
  if (opened.status === 'failed') {
    return <p className="error" role="alert">{`Aether could not open the session. ${opened.message}`}</p>
  }
  return <EmptyPage icon={<SearchX size={36} />} title="Not found" body="This session no longer exists." />
}
