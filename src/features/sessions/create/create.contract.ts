import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { MODES } from '../../../building-blocks/mode'
import { attachmentSchema } from '../session'

/**
 * Creates a session for a profile. It saves the row and starts no agent: a later story starts
 * the session. The title is the first line of the prompt. The mode is saved as chosen, also
 * Approve all: only a new session never copies it (decision 0012).
 */
export const createSession = defineContract(
  'sessions.create',
  z.strictObject({
    profileId: z.string().min(1),
    prompt: z.string().trim().min(1).max(200_000),
    mode: z.enum(MODES),
    model: z.string().min(1).max(100),
    /** The repository or folder that the session starts from. */
    sourcePath: z.string().trim().min(1).max(1024),
    attachments: z.array(attachmentSchema).max(200)
  }),
  z.strictObject({ id: z.string() }),
  ['unknown-profile', 'invalid-source-path'],
  {
    valid: [
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: 'C:\\work\\repo', attachments: [] },
      {
        profileId: 'w1',
        prompt: ' Fix the login page\nThen test it. ',
        mode: 'approve-all',
        model: 'claude-opus-5-5',
        sourcePath: 'C:\\work\\repo',
        attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }]
      }
    ],
    invalid: [
      null,
      {},
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: 'C:\\work' },
      { profileId: '', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: 'C:\\work', attachments: [] },
      { profileId: 'w1', prompt: ' \n ', mode: 'ask', model: 'default', sourcePath: 'C:\\work', attachments: [] },
      { profileId: 'w1', prompt: 'Say hello', mode: 'interactive', model: 'default', sourcePath: 'C:\\work', attachments: [] },
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: '', sourcePath: 'C:\\work', attachments: [] },
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: ' ', attachments: [] },
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: 'C:\\work', attachments: [{ kind: 'file' }] },
      { profileId: 'w1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: 'C:\\work', attachments: [], extra: true }
    ]
  }
)

export type CreateSessionError = (typeof createSession.errors)[number]
