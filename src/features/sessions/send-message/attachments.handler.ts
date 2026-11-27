import type { PromptLink } from '../../../building-blocks/agent.port'
import { absoluteIn, isInsideFolder } from '../../../building-blocks/folder'
import { FILE_KINDS, type Session } from '../session'

/**
 * What the agent gets from the attachments of a session (decision 0012, item 5; check A15). Both
 * functions read the saved session, never the renderer. They are separate from the handler, so
 * the handler stays short.
 */

const isFile = (kind: string): boolean => (FILE_KINDS as readonly string[]).includes(kind)

/** The file or folder of each attachment of the first message, as an absolute path with its label. */
export function linksOf({ attachments, sourcePath }: Pick<Session, 'attachments' | 'sourcePath'>): PromptLink[] {
  return attachments
    .filter(({ kind }) => isFile(kind))
    .map(({ ref, label }) => {
      const path = absoluteIn(sourcePath, ref)
      return { path, name: label || path }
    })
}

/**
 * The folders of the `folder` attachments that lie outside the session folder, each once. The agent
 * can reach them only when its session names them. A folder at or under the session folder needs no entry.
 */
export function additionalDirectoriesOf({ attachments, sourcePath }: Pick<Session, 'attachments' | 'sourcePath'>): string[] {
  const found: string[] = []
  for (const { kind, ref } of attachments) {
    if (kind !== 'folder') continue
    const path = absoluteIn(sourcePath, ref)
    if (isInsideFolder(sourcePath, path)) continue
    if (!found.some((other) => isInsideFolder(other, path) && isInsideFolder(path, other))) found.push(path)
  }
  return found
}
