import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, githubAccountInputSchema, workspaceDirectorySchema, profileNameSchema } from '../profile'

/** Adds a profile and makes it the current one. */
export const addProfile = defineContract(
  'profiles.add',
  z.strictObject({
    name: profileNameSchema,
    workspaceDirectory: workspaceDirectorySchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema
  }),
  z.strictObject({ id: z.string() }),
  ['invalid-workspace-directory', 'invalid-claude-folder'],
  {
    valid: [
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      {
        name: ' Client ',
        workspaceDirectory: 'C:\\client',
        github: { login: 'example-user', name: null, avatar: null },
        claudeFolder: 'C:\\claude'
      },
      // The login of a managed user of a GitHub enterprise has an underscore.
      { name: 'Managed', workspaceDirectory: 'C:\\managed', github: { login: 'example_user_ab12', name: null, avatar: null }, claudeFolder: null }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null },
      { name: ' ', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      { name: 'Work', workspaceDirectory: '', github: null, claudeFolder: null },
      { name: 'Work', workspaceDirectory: 'C:\\work', github: { login: 'bad login', name: null, avatar: null }, claudeFolder: null },
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, extra: true },
      // The field "Claude profile name" is gone (user decision, 2026-11-27).
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: 'work' }
    ]
  }
)

export type AddProfileError = (typeof addProfile.errors)[number]
