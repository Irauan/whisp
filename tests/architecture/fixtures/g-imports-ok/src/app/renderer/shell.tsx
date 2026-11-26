// Fixture of valid imports in the target layout: the shell imports UI and the registry.
import { SendMessage } from '../../features/sessions/send-message/send-message.ui'
import { registry } from '../contracts'

export const Shell = () => <SendMessage key={registry.length} />
