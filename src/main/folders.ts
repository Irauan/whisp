import { stat } from 'node:fs/promises'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import type { FolderInfo } from '../shared/bridge'
import { git } from './repository'

async function choose(options: OpenDialogOptions): Promise<string[]> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

export async function chooseFolder(): Promise<string | null> {
  const [folder] = await choose({
    title: 'Choose a folder',
    properties: ['openDirectory', 'createDirectory']
  })
  return folder ?? null
}

export function chooseFolders(): Promise<string[]> {
  return choose({ title: 'Add folders', properties: ['openDirectory', 'multiSelections'] })
}

export function chooseFiles(): Promise<string[]> {
  return choose({ title: 'Add files', properties: ['openFile', 'multiSelections'] })
}

/** The branch is null without a commit, because a worktree needs a commit. */
async function readBranch(folder: string): Promise<string | null> {
  return (await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() ?? null
}

export async function inspectFolder(folder: string): Promise<FolderInfo> {
  const exists = await stat(folder).then(
    (entry) => entry.isDirectory(),
    () => false
  )
  return { exists, branch: exists ? await readBranch(folder) : null }
}
