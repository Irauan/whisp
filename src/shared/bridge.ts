import type { Attachment, GithubProfile, Workspace } from './model'

export type GithubAccounts =
  | { ok: true; profiles: GithubProfile[] }
  | { ok: false; reason: string }

export type Listing = { ok: true; items: Attachment[] } | { ok: false; reason: string }

export interface FolderInfo {
  exists: boolean
  /** Null when the folder is not a Git repository with a commit. */
  branch: string | null
}

export interface AetherBridge {
  platform: string
  /**
   * Calls the slice that has this contract name. It resolves to a `Result`. It rejects only when
   * the main process cannot answer. The name must be in the contract registry.
   */
  invoke(name: string, input: unknown): Promise<unknown>
  /** Calls back with the payload of each event of this name. Returns a function that stops it. */
  subscribe(name: string, callback: (payload: unknown) => void): () => void
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<void>
  /** Lists the GitHub accounts that the GitHub CLI is signed in to. */
  listGithubAccounts(): Promise<GithubAccounts>
  /** Opens the folder picker. Null means that the user canceled. */
  chooseFolder(): Promise<string | null>
  chooseFolders(): Promise<string[]>
  chooseFiles(): Promise<string[]>
  inspectFolder(folder: string): Promise<FolderInfo>
  listRepositoryFiles(folder: string): Promise<Listing>
  /** Lists the open issues and pull requests of the repository in the folder. */
  listIssues(folder: string, githubLogin: string | null): Promise<Listing>
}
