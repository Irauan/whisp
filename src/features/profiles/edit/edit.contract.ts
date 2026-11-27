import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, claudeProfileNameSchema, githubAccountInputSchema, workspaceDirectorySchema, profileNameSchema } from '../profile'

/** Saves the settings of a profile: name, workspaceDirectory, GitHub account, Claude folder and Claude profile. */
export const editProfile = defineContract(
  'profiles.edit',
  z.strictObject({
    id: z.string().min(1),
    name: profileNameSchema,
    workspaceDirectory: workspaceDirectorySchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema,
    claudeProfileName: claudeProfileNameSchema
  }),
  z.strictObject({}),
  ['unknown-profile', 'invalid-workspace-directory', 'invalid-claude-folder'],
  {
    valid: [
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      {
        id: 'w1',
        name: 'Work',
        workspaceDirectory: 'C:\\work',
        github: { login: 'example-user', name: 'Example User', avatar: null },
        claudeFolder: 'C:\\claude',
        claudeProfileName: 'work'
      }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      { id: '', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      { id: 'w1', name: '', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null },
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: '', claudeProfileName: null },
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: null, extra: 1 }
    ]
  }
)

export type EditProfileError = (typeof editProfile.errors)[number]
