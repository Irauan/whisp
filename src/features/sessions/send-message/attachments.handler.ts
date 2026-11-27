import type { PromptLink } from '../../../building-blocks/agent.port'
import { absoluteIn } from '../../../building-blocks/folder'
import { isInside, pathKey, resolveReal } from '../../../building-blocks/paths'
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
 * The real paths of the `folder` attachments that lie outside the session folder, each once, in the
 * order of the attachments. Each path is resolved as the questions of story S6 resolve it: `..`,
 * junctions and letter case go away. A folder that is the session folder, or lies in it, needs no
 * entry, also when it is a junction to such a folder. The agent can reach the other folders only
 * when its session names them, and the start asks the questions for each of them first.
 */
export function additionalDirectoriesOf({ attachments, sourcePath }: Pick<Session, 'attachments' | 'sourcePath'>): string[] {
  const main = pathKey(sourcePath)
  const found = new Map<string, string>()
  for (const { kind, ref } of attachments) {
    if (kind !== 'folder') continue
    const real = resolveReal(absoluteIn(sourcePath, ref))
    const key = pathKey(real)
    if (isInside(key, main) || found.has(key)) continue
    found.set(key, real)
  }
  return [...found.values()]
}
