import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, claudeProfileSchema, githubAccountInputSchema, rootSchema, workspaceNameSchema } from '../workspace'

/** Adds a workspace and makes it the current one. */
export const addWorkspace = defineContract(
  'workspaces.add',
  z.strictObject({
    name: workspaceNameSchema,
    root: rootSchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema,
    claudeProfile: claudeProfileSchema
  }),
  z.strictObject({ id: z.string() }),
  ['invalid-root', 'invalid-claude-folder'],
  {
    valid: [
      { name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      {
        name: ' Client ',
        root: 'C:\\client',
        github: { login: 'example-user', name: null, avatar: null },
        claudeFolder: 'C:\\claude',
        claudeProfile: 'client'
      }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', root: 'C:\\work', github: null, claudeFolder: null },
      { name: ' ', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      { name: 'Work', root: '', github: null, claudeFolder: null, claudeProfile: null },
      { name: 'Work', root: 'C:\\work', github: { login: 'bad login', name: null, avatar: null }, claudeFolder: null, claudeProfile: null },
      { name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null, extra: true }
    ]
  }
)

export type AddWorkspaceError = (typeof addWorkspace.errors)[number]
