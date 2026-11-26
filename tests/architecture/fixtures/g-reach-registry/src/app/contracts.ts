// Fixture: the registry that the renderer may import. It imports a handler.
import { handle } from '../features/sessions/send-message/send-message.handler'

export const registry = [handle]
