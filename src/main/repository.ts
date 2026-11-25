import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { Listing } from '../shared/bridge'
import type { Attachment } from '../shared/model'

const MAX_FILES = 50_000

/** Returns null on failure. */
export function git(folder: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      // A repository can name a program in core.fsmonitor. Do not run it.
      ['-C', folder, '-c', 'core.fsmonitor=false', ...args],
      {
        // Windows also looks for the program in the working folder, so do not use the given folder.
        cwd: homedir(),
        timeout: 15_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout) => resolve(error ? null : stdout)
    )
  })
}

/** Adds the folders of the files. Folders come first. */
export function toAttachments(files: string[]): Attachment[] {
  const folders = new Set<string>()
  for (const file of files) {
    for (let end = file.lastIndexOf('/'); end > 0; end = file.lastIndexOf('/', end - 1)) {
      folders.add(file.slice(0, end))
    }
  }
  return [
    ...[...folders].sort().map((path): Attachment => ({
      kind: 'repository-folder',
      ref: path,
      label: `${path}/`
    })),
    ...files.map((path): Attachment => ({ kind: 'repository-file', ref: path, label: path }))
  ]
}

export async function listRepositoryFiles(folder: string): Promise<Listing> {
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
  const output = await git(folder, args)
  if (output === null) return { ok: false, reason: 'The folder is not a Git repository.' }
  const files = [...new Set(output.split('\0').filter(Boolean))].slice(0, MAX_FILES)
  return { ok: true, items: toAttachments(files) }
}
