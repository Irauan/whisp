// Fixture: a contract that imports its handler. Renderer code that imports this contract
// reaches the handler.
import { handle } from './send-message.handler'

export const sendMessage = { name: 'sessions.send-message', handle }
