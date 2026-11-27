import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, githubAccountInputSchema, workspaceDirectorySchema, profileNameSchema } from '../profile'

/** Saves the settings of a profile: name, workspaceDirectory, GitHub account, Claude folder. */
export const editProfile = defineContract(
  'profiles.edit',
  z.strictObject({
    id: z.string().min(1),
    name: profileNameSchema,
    workspaceDirectory: workspaceDirectorySchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema
  }),
  z.strictObject({}),
  ['unknown-profile', 'invalid-workspace-directory', 'invalid-claude-folder'],
  {
    valid: [
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      {
        id: 'w1',
        name: 'Work',
        workspaceDirectory: 'C:\\work',
        github: { login: 'example-user', name: 'Example User', avatar: null },
        claudeFolder: 'C:\\claude'
      }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      { id: '', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      { id: 'w1', name: '', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null },
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: '' },
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, extra: 1 },
      // The field "Claude profile name" is gone (user decision, 2026-11-27).
      { id: 'w1', name: 'Work', workspaceDirectory: 'C:\\work', github: null, claudeFolder: null, claudeProfileName: 'work' }
    ]
  }
)

export type EditProfileError = (typeof editProfile.errors)[number]
