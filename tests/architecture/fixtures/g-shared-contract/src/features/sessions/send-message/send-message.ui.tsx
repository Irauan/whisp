// Fixture: renderer code that imports its contract. It is allowed to do so.
import { sendMessage } from './send-message.contract'

export const SendMessage = () => <button>{sendMessage.name}</button>
