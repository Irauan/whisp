import type { Mode } from '../../building-blocks/mode'
import type { Result } from '../../building-blocks/result'

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
  /** The message for a missing sign-in, with the sign-in steps of these settings. */
  notSignedIn(settings: Readonly<Record<string, unknown>>): string
}
