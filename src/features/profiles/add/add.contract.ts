import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, claudeProfileNameSchema, githubAccountInputSchema, workspaceDirectorySchema, profileNameSchema } from '../profile'

/** Adds a profile and makes it the current one. */
export const addProfile = defineContract(
  'profiles.add',
  z.strictObject({
    name: profileNameSchema,
    workspaceDirectory: workspaceDirectorySchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema,
    claudeProfileName: claudeProfileNameSchema
  }),
  z.strictObject({ id: z.string() }),
  ['invalid-workspace-directory', 'invalid-claude-folder'],
  {
    valid: [
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      {
        name: ' Client ',
        workspaceDirectory: 'C:\\client',
        github: { login: 'example-user', name: null, avatar: null },
        claudeFolder: 'C:\\claude',
        claudeProfileName: 'client'
      },
      // The login of a managed user of a GitHub enterprise has an underscore.
      { name: 'Managed', workspaceDirectory: 'C:\\managed', github: { login: 'example_user_ab12', name: null, avatar: null }, claudeFolder: null, claudeProfileName: null }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      { name: ' ', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      { name: 'Work', workspaceDirectory: '', github: null, claudeFolder: null, claudeProfileName: null },
      { name: 'Work', workspaceDirectory: 'C:\\work', github: { login: 'bad login', name: null, avatar: null }, claudeFolder: null, claudeProfileName: null },
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null, extra: true }
    ]
  }
)

export type AddProfileError = (typeof addProfile.errors)[number]
