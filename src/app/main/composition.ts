import { basename, join } from 'node:path'
import { systemClock, type Clock } from '../../building-blocks/clock.port'
import { openDatabase, type OpenError } from '../../building-blocks/database'
import { randomIds, type Ids } from '../../building-blocks/ids'
import type { GithubPort } from '../../building-blocks/github.port'
import { MIGRATIONS } from '../../building-blocks/migrations'
import { ok, type Result } from '../../building-blocks/result'
import { addWorkspace } from '../../features/workspaces/add/add.contract'
import { addWorkspaceController } from '../../features/workspaces/add/add.controller'
import { chooseRoots } from '../../features/workspaces/choose-roots/choose-roots.contract'
import { chooseRootsController } from '../../features/workspaces/choose-roots/choose-roots.controller'
import { editWorkspace } from '../../features/workspaces/edit/edit.contract'
import { editWorkspaceController } from '../../features/workspaces/edit/edit.controller'
import { importOldFilesHandler } from '../../features/workspaces/import-old-files/import-old-files.handler'
import { ImportStore } from '../../features/workspaces/import-old-files/import-old-files.store'
import { listGithubAccounts } from '../../features/workspaces/list-github-accounts/list-github-accounts.contract'
import { listGithubAccountsController } from '../../features/workspaces/list-github-accounts/list-github-accounts.controller'
import { listWorkspaces } from '../../features/workspaces/list/list.contract'
import { listWorkspacesController } from '../../features/workspaces/list/list.controller'
import { removeWorkspace } from '../../features/workspaces/remove/remove.contract'
import { removeWorkspaceController } from '../../features/workspaces/remove/remove.controller'
import { switchWorkspace } from '../../features/workspaces/switch/switch.contract'
import { switchWorkspaceController } from '../../features/workspaces/switch/switch.controller'
import type { Notice } from '../../features/workspaces/workspace'
import { WorkspaceStore } from '../../features/workspaces/workspace.store'
import { listSessions } from '../../features/sessions/list/list.contract'
import { listSessionsController } from '../../features/sessions/list/list.controller'
import type { Controller } from './ipc'

/** The name of the database in the data folder (`userData`). */
export const DATABASE_FILE = 'aether.db'

/** The old file that the import reads. Aether never writes it. */
export const OLD_WORKSPACE_FILE = 'workspace.json'

export interface Composition {
  /** The controller of each contract in the registry, by contract name. */
  controllers: Record<string, Controller>
  /** The messages about the start. The snapshot of the workspaces carries them to the window. */
  notices: Notice[]
  /** Closes the database. */
  close(): void
}

export interface CompositionDeps {
  /** The data folder: `userData`. */
  dataDir: string
  github: GithubPort
  clock?: Clock
  ids?: Ids
}

/**
 * Opens the database, runs the import of the old files and connects the controllers.
 * It returns an error when the database cannot open: a newer version, or a failure that Aether
 * cannot repair. The caller then tells the user and exits, and Aether writes nothing.
 * An unreadable database or `workspace.json` is not an error: the start goes on, with a notice.
 */
export function composeMain({ dataDir, github, clock = systemClock, ids = randomIds }: CompositionDeps): Result<Composition, OpenError> {
  const opened = openDatabase(join(dataDir, DATABASE_FILE), MIGRATIONS, () => clock.now())
  if (!opened.ok) return opened
  const { database, keptAside } = opened.value

  const notices: Notice[] = []
  if (keptAside) {
    notices.push({
      code: 'database-unreadable',
      message: `Aether could not read its database. It kept the file as ${basename(keptAside)} and started with a new database.`
    })
  }

  const imported = importOldFilesHandler({
    workspaces: new WorkspaceStore(database),
    imports: new ImportStore(database),
    clock,
    ids,
    file: join(dataDir, OLD_WORKSPACE_FILE)
  })
  if (!imported.ok) notices.push({ code: 'workspace-file-unreadable', message: imported.error.message })

  return ok({
    controllers: {
      [listGithubAccounts.name]: listGithubAccountsController(github),
      [listWorkspaces.name]: listWorkspacesController(database, () => notices),
      [chooseRoots.name]: chooseRootsController(database),
      [addWorkspace.name]: addWorkspaceController(database, clock, ids),
      [editWorkspace.name]: editWorkspaceController(database),
      [switchWorkspace.name]: switchWorkspaceController(database),
      [removeWorkspace.name]: removeWorkspaceController(database),
      [listSessions.name]: listSessionsController(database)
    },
    notices,
    close: () => database.close()
  })
}
