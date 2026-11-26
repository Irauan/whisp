// Fixture of valid imports in the target layout: a handler imports its own files, the root
// files of its feature and building-blocks.
import type { Result } from '../../../building-blocks/result'
import type { Session } from '../session'
import { load } from '../session.store'
import { sendMessage } from './send-message.contract'

export const handle = (path: string): Result<string> => {
  const session: Session | undefined = load(path)
  return { ok: true, value: `${sendMessage.name} ${session?.id ?? ''}` }
}
