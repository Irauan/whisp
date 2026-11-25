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

export function AttachmentIcon({ kind, size }: { kind: Attachment['kind']; size: number }) {
  const Icon = ICONS[kind]
  return <Icon size={size} />
}
