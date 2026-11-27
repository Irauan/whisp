import { z } from 'zod'

/** The kinds of provider. Each kind has its own settings schema. Aether stores no key and no token. */
export const PROVIDER_KINDS = ['claude-code'] as const

export type ProviderKind = (typeof PROVIDER_KINDS)[number]

/**
 * The settings of the provider `claude-code`: the Claude configuration folder (`CLAUDE_CONFIG_DIR`)
 * and the Claude profile name (`ANTHROPIC_PROFILE`). A setting that the user did not choose is absent.
 */
export const claudeCodeSettingsSchema = z.strictObject({
  configFolder: z.string().min(1).optional(),
  profileName: z.string().min(1).optional()
})

export type ClaudeCodeSettings = z.output<typeof claudeCodeSettingsSchema>

/** The settings schema of each kind. The database holds the settings as JSON, and Aether checks them with this. */
export const SETTINGS_SCHEMAS = {
  'claude-code': claudeCodeSettingsSchema
} as const satisfies Record<ProviderKind, z.ZodType>

/** What the user chose for the provider `claude-code`. Null means that the user chose nothing. */
export interface ClaudeChoice {
  configFolder: string | null
  profileName: string | null
}

export const isProviderKind = (kind: string): kind is ProviderKind => (PROVIDER_KINDS as readonly string[]).includes(kind)

/**
 * Checks the settings of a provider against the schema of its kind. The database has no CHECK for
 * the kind, so this is the only check. An unknown kind and settings that break the schema throw:
 * the caller passes a kind that the code knows, so a failure is a defect.
 * @returns The settings as the schema parsed them, with no unknown key.
 */
export function parseSettings(kind: string, value: unknown): ClaudeCodeSettings {
  if (!isProviderKind(kind)) throw new Error(`Aether does not know the provider kind "${kind}".`)
  return SETTINGS_SCHEMAS[kind].parse(value)
}

/** The settings JSON of a choice. An empty choice gives an empty object. */
export function claudeSettingsOf({ configFolder, profileName }: ClaudeChoice): ClaudeCodeSettings {
  return {
    ...(configFolder === null ? {} : { configFolder }),
    ...(profileName === null ? {} : { profileName })
  }
}
