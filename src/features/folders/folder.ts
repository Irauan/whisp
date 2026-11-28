import { z } from 'zod'

/**
 * One folder of a profile, as the sidebar shows it as a group (story S11). A folder exists also when no
 * session uses it. A session joins its folder by the profile and the path.
 */
export const folderSchema = z.strictObject({
  id: z.string(),
  /** An absolute path, as `sessions.source_path`. */
  path: z.string(),
  /** True when the group of the sidebar is collapsed. */
  collapsed: z.boolean()
})

export type Folder = z.output<typeof folderSchema>

/** The text of an error that more than one slice returns. */
export const MESSAGES = {
  unknownProfile: 'This profile does not exist.',
  unknownFolder: 'This folder does not exist any more.',
  invalidPath: 'The folder must be an existing folder, with an absolute path.',
  hasSessions: 'This folder still has sessions. Delete its sessions first.'
} as const
