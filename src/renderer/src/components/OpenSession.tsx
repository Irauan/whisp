import { SearchX } from 'lucide-react'
import { useSession } from '../useSession'
import { EmptyPage } from './Pages'
import { SessionPage } from './SessionPage'

/**
 * The window of one session. It loads the session through the slice `sessions.open` and follows its
 * events. The caller gives it a `key` with the session ID, so that a new session starts with a new state.
 */
export function OpenSession({
  id,
  asking,
  stripSlot,
  onSettingsSaved,
  onDelete
}: {
  id: string
  /** True while a question of the main process waits for the user, for example the trust question. */
  asking: boolean
  /** The place of the title in the title strip of the shell. */
  stripSlot: HTMLElement | null
  onSettingsSaved(): void
  onDelete(): void
}) {
  const opened = useSession(id)

  switch (opened.status) {
    case 'loading':
      return null
    case 'opened':
      return <SessionPage view={opened.view} asking={asking} stripSlot={stripSlot} onSettingsSaved={onSettingsSaved} onDelete={onDelete} />
    case 'failed':
      return <p className="error" role="alert">{`Aether could not open the session. ${opened.message}`}</p>
    case 'missing':
      return <EmptyPage icon={<SearchX size={36} />} title="Not found" body="This session no longer exists." />
  }
}
