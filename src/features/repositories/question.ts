import { z } from 'zod'

/**
 * The questions that the main process asks before an agent process starts (architecture, Directories
 * and trust). The main process builds each question from the saved session and from what it finds on
 * disk. The renderer only shows it and sends back one answer, so the renderer cannot grant anything
 * that the main process did not offer.
 */

export const ANSWERS = ['trust', 'allow-once', 'allow-always', 'cancel'] as const
export const answerSchema = z.enum(ANSWERS)
export type Answer = z.output<typeof answerSchema>

const foundSchema = {
  /** The command hooks of every event. The agent runs them without a question. */
  hooks: z.array(z.strictObject({ event: z.string(), command: z.string() })),
  mcpServers: z.array(z.strictObject({ name: z.string(), command: z.string().nullable() })),
  /** Each settings file and `.mcp.json` that exists, with the names of its other top-level keys. */
  files: z.array(z.strictObject({ name: z.string(), keys: z.array(z.string()) })),
  /** The files that exist but that Aether could not read. */
  unreadable: z.array(z.string())
}

const base = {
  id: z.string(),
  sessionId: z.string(),
  profileName: z.string(),
  /** The session folder, as the session saved it. */
  folder: z.string()
}

export const questionSchema = z.discriminatedUnion('kind', [
  /** A Git repository, or a plain folder with a settings file or an `.mcp.json`, in the workspace directory of the profile. */
  z.strictObject({ kind: z.literal('trust'), ...base, repository: z.string(), ...foundSchema }),
  /** A folder outside the workspace directory of the profile. */
  z.strictObject({ kind: z.literal('outside'), ...base, ...foundSchema }),
  /** A folder under the workspace directory of another profile. */
  z.strictObject({
    kind: z.literal('other-profile'),
    ...base,
    otherProfileName: z.string(),
    /** The Claude folder that would read the files, or null for the default folder of Claude. */
    claudeFolder: z.string().nullable(),
    ...foundSchema
  })
])

export type Question = z.output<typeof questionSchema>
export type QuestionKind = Question['kind']

/** The answers that each kind of question offers. The main process rejects any other answer. */
export const OFFERED: Record<QuestionKind, readonly Answer[]> = {
  trust: ['trust', 'cancel'],
  outside: ['allow-once', 'allow-always', 'cancel'],
  'other-profile': ['allow-once', 'allow-always', 'cancel']
}

/** A question before the main process gives it an ID. */
export type NewQuestion = Question extends infer Each ? (Each extends Question ? Omit<Each, 'id'> : never) : never

/** One change of the list of open questions. The list is in the order of asking, oldest first. */
export const questionChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('opened'), question: questionSchema }),
  z.strictObject({ type: z.literal('closed'), id: z.string() })
])

export type QuestionChange = z.output<typeof questionChangeSchema>

/**
 * The event `repositories.questions-changed` (decision 0002). The revision counts the changes of the
 * list in the main process, from 1. A gap in the revisions tells the renderer to load a new snapshot.
 */
export const questionEventSchema = z.strictObject({
  revision: z.number().int().min(1),
  change: questionChangeSchema
})

export type QuestionEvent = z.output<typeof questionEventSchema>

export const QUESTIONS_CHANGED = 'repositories.questions-changed'

/** The notices after a refusal. The first one is the exact text of the brief, state "Trust refused". */
export const REFUSALS = {
  trust: { code: 'trust-refused', message: 'Aether did not start the agent in this repository.' },
  directory: { code: 'directory-refused', message: 'Aether did not start the agent in this folder.' }
} as const
