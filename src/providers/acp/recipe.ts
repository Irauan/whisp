import type { Mode } from '../../building-blocks/mode'
import type { Result } from '../../building-blocks/result'

/** What the recipe needs to know about a form of the agent, to tell which form it is. */
export interface FormShape {
  /** The ID of the tool call that asks, or null. */
  toolId: string | null
  /** The fields, in the order of the form. A choice field lists the values of its options. */
  fields: readonly { key: string; kind: 'choice' | 'choices' | 'text'; values: readonly string[] }[]
}

/** The facts about a form that only the recipe of an agent knows. */
export interface FormFacts {
  /** The value of the option that Aether shows first and as the primary button, or null. */
  recommended: string | null
  /** True when the typed text can be saved. False for a form that can hold a secret. */
  keepsText: boolean
  /** For a text field that completes a choice field (the "Other" of a question): the key of that choice field. */
  completes: Readonly<Record<string, string>>
}

/** The program that starts an agent, and the variables that only this agent needs. */
export interface Launch {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * What `providers/acp` needs to know about one agent: how to start it and how it names things.
 * `providers/claude-code` is the recipe of Claude Code. The composition root connects both.
 */
export interface AcpRecipe {
  /** The name of the agent in messages, for example "Claude Code". */
  readonly name: string
  /**
   * The program and the arguments, and the variables that the settings of the provider give. An
   * error says why the agent cannot start: a missing program, or settings that the agent refuses.
   */
  launch(settings: Readonly<Record<string, unknown>>): Promise<Result<Launch>>
  /** The ID of the permission mode of the agent for a mode of the port. */
  modeId(mode: Mode): string
  /** The mode of the port for the ID of a permission mode of the agent, or null for an ID that the port does not know. */
  modeOf(id: string): Mode | null
  /** The facts about a form of the agent: which option is recommended, if the text can be saved, and which text field completes which choice. */
  formFacts(form: FormShape): FormFacts
  /** The message for a missing sign-in, with the sign-in steps of these settings. */
  notSignedIn(settings: Readonly<Record<string, unknown>>): string
}
