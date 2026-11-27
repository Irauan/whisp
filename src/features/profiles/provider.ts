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

/** The settings JSON of a choice. An empty choice gives an empty object. */
export function claudeSettingsOf({ configFolder, profileName }: ClaudeChoice): ClaudeCodeSettings {
  return {
    ...(configFolder === null ? {} : { configFolder }),
    ...(profileName === null ? {} : { profileName })
  }
}
