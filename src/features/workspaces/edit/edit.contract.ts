import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { claudeFolderSchema, claudeProfileSchema, githubAccountInputSchema, rootSchema, workspaceNameSchema } from '../workspace'

/** Saves the settings of a workspace: name, root, GitHub account, Claude folder and Claude profile. */
export const editWorkspace = defineContract(
  'workspaces.edit',
  z.strictObject({
    id: z.string().min(1),
    name: workspaceNameSchema,
    root: rootSchema,
    github: githubAccountInputSchema.nullable(),
    claudeFolder: claudeFolderSchema,
    claudeProfile: claudeProfileSchema
  }),
  z.strictObject({}),
  ['unknown-workspace', 'invalid-root', 'invalid-claude-folder'],
  {
    valid: [
      { id: 'w1', name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      {
        id: 'w1',
        name: 'Work',
        root: 'C:\\work',
        github: { login: 'example-user', name: 'Example User', avatar: null },
        claudeFolder: 'C:\\claude',
        claudeProfile: 'work'
      }
    ],
    invalid: [
      null,
      {},
      { name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      { id: '', name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      { id: 'w1', name: '', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null },
      { id: 'w1', name: 'Work', root: 'C:\\work', github: null, claudeFolder: '', claudeProfile: null },
      { id: 'w1', name: 'Work', root: 'C:\\work', github: null, claudeFolder: null, claudeProfile: null, extra: 1 }
    ]
  }
)

export type EditWorkspaceError = (typeof editWorkspace.errors)[number]
