import { sendMessageHandler, type SendMessageDeps } from './send-message.handler'

/**
 * The input is already parsed against the contract. The controller answers when Aether accepted the
 * message. The turn runs on: `finished` never rejects, and the transcript tells the renderer how it goes.
 */
export const sendMessageController = (deps: SendMessageDeps) => async (input: { id: string; text: string }) => {
  const { result } = sendMessageHandler(deps, input)
  return result
}
