import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Sends one message of the user to the agent of a session. The first message of a session starts
 * its agent process (flow 2 and flow 6). The call returns when Aether accepted the message. It does
 * not wait for the reply: the renderer gets the progress as events `sessions.changed`.
 *
 * The input holds the text only. The folder, the mode, the model and the attachments come from the
 * saved session, never from the renderer (architecture, IPC).
 */
export const sendMessage = defineContract(
  'sessions.send-message',
  z.strictObject({
    id: z.string().min(1),
    text: z.string().trim().min(1).max(200_000)
  }),
  z.strictObject({}),
  ['unknown-session', 'turn-active', 'invalid-folder'],
  {
    valid: [
      { id: 's1', text: 'Say hello' },
      { id: 's1', text: '  Fix the login page\nThen test it.  ' }
    ],
    invalid: [
      null,
      {},
      { id: 's1' },
      { id: '', text: 'Say hello' },
      { id: 's1', text: ' \n ' },
      { id: 's1', text: 7 },
      { id: 's1', text: 'Say hello', cwd: 'C:\\elsewhere' },
      { id: 's1', text: 'Say hello', mode: 'approve-all' }
    ]
  }
)

export type SendMessageError = (typeof sendMessage.errors)[number]
