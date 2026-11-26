// Fixture of valid imports in the target layout: app/main connects providers to features.
import { handle } from '../../features/sessions/send-message/send-message.handler'
import { clock } from '../../providers/acp/client'

export const start = () => handle(String(clock.now()))
