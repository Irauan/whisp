import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { Mode } from '../../building-blocks/mode'
import { err, ok, type Result } from '../../building-blocks/result'
import type { AcpRecipe, Launch } from '../acp/recipe'

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
 * folder and the Claude profile name. A setting that the user did not choose is absent.
 */
const settingsSchema = z.object({
  configFolder: z.string().min(1).optional(),
  profileName: z.string().min(1).optional()
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
 * The adapter that Aether ships with. It runs the Claude Code that comes with it.
 * `--hide-claude-auth` keeps Aether off claude.ai subscriptions: Anthropic does not allow other
 * products to use them. Claude Code then runs on an Anthropic Console sign-in.
 */
function builtIn(): Result<Pick<Launch, 'command' | 'args'>> {
  let script: string
  try {
    script = join(dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json')), 'dist/index.js')
  } catch {
    return err('adapter-missing', 'The Claude Code adapter is not installed.')
  }
  // Electron runs the adapter as plain Node (see ELECTRON_RUN_AS_NODE below), so the user needs no Node install.
  return ok({ command: process.execPath, args: [script, '--hide-claude-auth'] })
}

function parseSettings(settings: Readonly<Record<string, unknown>>): Result<ClaudeSettings> {
  const parsed = settingsSchema.safeParse(settings)
  return parsed.success ? ok(parsed.data) : err('invalid-settings', 'The Claude settings of this session are not valid.')
}

/** The variables that the Claude settings give. */
function claudeEnvironment({ configFolder, profileName }: ClaudeSettings): Record<string, string> {
  return {
    ...(configFolder === undefined ? {} : { CLAUDE_CONFIG_DIR: configFolder }),
    ...(profileName === undefined ? {} : { ANTHROPIC_PROFILE: profileName })
  }
}

/** The sign-in steps for the Claude settings of a session. */
export function signInSteps(settings: Readonly<Record<string, unknown>>): string {
  const parsed = settingsSchema.safeParse(settings)
  const { configFolder, profileName } = parsed.success ? parsed.data : {}
  const steps = [
    'Claude Code is not signed in.',
    'Sign in with an Anthropic Console account.',
    'Open a terminal.',
    ...(configFolder === undefined ? [] : [`Set CLAUDE_CONFIG_DIR to ${configFolder}.`]),
    ...(profileName === undefined ? [] : [`Set ANTHROPIC_PROFILE to ${profileName}.`]),
    'Run `npx @agentclientprotocol/claude-agent-acp --cli auth login --console`.',
    'Then send your message again.'
  ]
  return steps.join(' ')
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
    notSignedIn: signInSteps
  }
}
