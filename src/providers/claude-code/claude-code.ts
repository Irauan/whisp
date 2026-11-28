import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { MODES, type Mode } from '../../building-blocks/mode'
import { err, ok, type Result } from '../../building-blocks/result'
import type { AcpRecipe, FormFacts, FormShape, Launch } from '../acp/recipe'

/** The permission mode of Claude for each mode of the port (decision 0012). */
export const CLAUDE_MODES: Record<Mode, string> = {
  ask: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  auto: 'auto',
  'approve-all': 'bypassPermissions'
}

/**
 * The settings of the provider `claude-code`, as the session saved them: the Claude configuration
 * folder. A Claude account is only its folder (user decision, 2026-11-27). A setting that the user
 * did not choose is absent. A key of an earlier version, such as `profileName`, is dropped.
 */
const settingsSchema = z.object({
  configFolder: z.string().min(1).optional()
})

type ClaudeSettings = z.output<typeof settingsSchema>

/** The program and the arguments of the launch recipe, when `agents.json` replaces them. */
export interface LaunchOverride {
  command: string
  args: string[]
}

export interface ClaudeCodeOptions {
  /**
   * An entry of `agents.json` with the id `claude-code` replaces only the program and the arguments.
   * Everything else stays with this recipe. Null means that no entry exists. An error means that the
   * entry exists and cannot be used: the start fails with that message, and never falls back to the
   * built-in program.
   */
  override?: () => Promise<Result<LaunchOverride | null>>
}

const require = createRequire(__filename)

/**
 * The adapter that Aether ships with. It runs the Claude Code that comes with it. Aether uses the
 * Claude subscription of the user and never passes `--hide-claude-auth` (decision 0011).
 */
function builtIn(): Result<Pick<Launch, 'command' | 'args'>> {
  let script: string
  try {
    script = join(dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json')), 'dist/index.js')
  } catch {
    return err('adapter-missing', 'The Claude Code adapter is not installed.')
  }
  // Electron runs the adapter as plain Node (see ELECTRON_RUN_AS_NODE below), so the user needs no Node install.
  return ok({ command: process.execPath, args: [script] })
}

function parseSettings(settings: Readonly<Record<string, unknown>>): Result<ClaudeSettings> {
  const parsed = settingsSchema.safeParse(settings)
  return parsed.success ? ok(parsed.data) : err('invalid-settings', 'The Claude settings of this session are not valid.')
}

/** The variables that the Claude settings give. */
function claudeEnvironment({ configFolder }: ClaudeSettings): Record<string, string> {
  return configFolder === undefined ? {} : { CLAUDE_CONFIG_DIR: configFolder }
}

/** The sign-in steps for the Claude settings of a session. */
export function signInSteps(settings: Readonly<Record<string, unknown>>): string {
  const parsed = settingsSchema.safeParse(settings)
  const { configFolder } = parsed.success ? parsed.data : {}
  const steps = [
    'Claude Code is not signed in.',
    'Sign in with your Claude subscription.',
    'Open a terminal.',
    ...(configFolder === undefined ? [] : [`Set CLAUDE_CONFIG_DIR to ${configFolder}.`]),
    'Run `npx @agentclientprotocol/claude-agent-acp --cli auth login --claudeai`.',
    'Then send your message again.'
  ]
  return steps.join(' ')
}

/** The key of a question of AskUserQuestion, and of its free text ("Other"): `question_<n>` and `question_<n>_custom`. */
const QUESTION_KEY = /^question_(\d+)(_custom)?$/

/** The values of the two options of the refusal fallback dialog of the adapter (`elicitation.js`). */
const RETRY_FALLBACK = 'retry_fallback'
const KEEP_REFUSAL = 'cancelled'

/**
 * What Aether knows about the forms of the Claude Code adapter. A question of AskUserQuestion has a
 * tool call and keys `question_<n>`, with an optional `question_<n>_custom` that completes the
 * question. The refusal fallback dialog has one field `choice` with the two options above, and
 * "Keep the refusal" is the default of the adapter, so it is recommended. Any other form comes from an
 * MCP server and can hold a secret: Aether keeps no text of it.
 */
export function claudeFormFacts(form: FormShape): FormFacts {
  const isQuestion =
    form.toolId !== null && form.fields.length > 0 && form.fields.every((field) => QUESTION_KEY.test(field.key))
  if (isQuestion) {
    const completes: Record<string, string> = {}
    for (const field of form.fields) {
      const match = QUESTION_KEY.exec(field.key)
      if (field.kind === 'text' && match?.[2] !== undefined && form.fields.some((other) => other.key === `question_${match[1]}`)) {
        completes[field.key] = `question_${match[1]}`
      }
    }
    return { recommended: null, keepsText: true, completes }
  }
  const only = form.fields.length === 1 ? form.fields[0] : undefined
  if (only?.key === 'choice' && only.kind === 'choice' && only.values.length === 2 && only.values.includes(RETRY_FALLBACK) && only.values.includes(KEEP_REFUSAL)) {
    return { recommended: KEEP_REFUSAL, keepsText: true, completes: {} }
  }
  return { recommended: null, keepsText: false, completes: {} }
}

/** The launch recipe of Claude Code (decision 0006, 0012). */
export function claudeCodeRecipe(options: ClaudeCodeOptions = {}): AcpRecipe {
  return {
    name: 'Claude Code',
    async launch(settings) {
      const parsed = parseSettings(settings)
      if (!parsed.ok) return parsed
      const found = (await options.override?.()) ?? ok(null)
      if (!found.ok) return found
      const override = found.value
      const program = override === null ? builtIn() : ok(override)
      if (!program.ok) return program
      return ok({
        command: program.value.command,
        args: [...program.value.args],
        env: { ELECTRON_RUN_AS_NODE: '1', ...claudeEnvironment(parsed.value) }
      })
    },
    modeId: (mode) => CLAUDE_MODES[mode],
    modeOf: (id) => MODES.find((mode) => CLAUDE_MODES[mode] === id) ?? null,
    formFacts: claudeFormFacts,
    notSignedIn: signInSteps
  }
}
