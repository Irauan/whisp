import {
  CircleDot,
  File,
  Folder,
  GitPullRequest,
  MessageSquare,
  type LucideIcon
} from 'lucide-react'
import type { Attachment } from '../../../shared/model'

const ICONS: Record<Attachment['kind'], LucideIcon> = {
  file: File,
  folder: Folder,
  'repository-file': File,
  'repository-folder': Folder,
  issue: CircleDot,
  'pull-request': GitPullRequest,
  session: MessageSquare
}

/** The kind of a saved attachment is text. A kind that Aether does not know gets the file icon. */
export function AttachmentIcon({ kind, size }: { kind: string; size: number }) {
  const Icon = ICONS[kind as Attachment['kind']] ?? File
  return <Icon size={size} />
}
