import { basename, join } from 'node:path'
import { systemClock, type Clock } from '../../building-blocks/clock.port'
import { openDatabase, type OpenError } from '../../building-blocks/database'
import { randomIds, type Ids } from '../../building-blocks/ids'
import type { GithubPort } from '../../building-blocks/github.port'
import { MIGRATIONS } from '../../building-blocks/migrations'
import { ok, type Result } from '../../building-blocks/result'
import { addProfile } from '../../features/profiles/add/add.contract'
import { addProfileController } from '../../features/profiles/add/add.controller'
import { chooseDirectories } from '../../features/profiles/choose-directories/choose-directories.contract'
import { chooseDirectoriesController } from '../../features/profiles/choose-directories/choose-directories.controller'
import { editProfile } from '../../features/profiles/edit/edit.contract'
import { editProfileController } from '../../features/profiles/edit/edit.controller'
import { importOldFilesHandler } from '../../features/profiles/import-old-files/import-old-files.handler'
import { ImportStore } from '../../features/profiles/import-old-files/import-old-files.store'
import { listGithubAccounts } from '../../features/profiles/list-github-accounts/list-github-accounts.contract'
import { listGithubAccountsController } from '../../features/profiles/list-github-accounts/list-github-accounts.controller'
import { listProfiles } from '../../features/profiles/list/list.contract'
import { listProfilesController } from '../../features/profiles/list/list.controller'
import { removeProfile } from '../../features/profiles/remove/remove.contract'
import { removeProfileController } from '../../features/profiles/remove/remove.controller'
import { switchProfile } from '../../features/profiles/switch/switch.contract'
import { switchProfileController } from '../../features/profiles/switch/switch.controller'
import type { Notice } from '../../features/profiles/profile'
import { ProfileStore } from '../../features/profiles/profile.store'
import { createSession } from '../../features/sessions/create/create.contract'
import { createSessionController } from '../../features/sessions/create/create.controller'
import { deleteSession } from '../../features/sessions/delete/delete.contract'
import { deleteSessionController } from '../../features/sessions/delete/delete.controller'
import { listSessions } from '../../features/sessions/list/list.contract'
import { listSessionsController } from '../../features/sessions/list/list.controller'
import { openSession } from '../../features/sessions/open/open.contract'
import { openSessionController } from '../../features/sessions/open/open.controller'
import type { Controller } from './ipc'

/** The name of the database in the data folder (`userData`). */
export const DATABASE_FILE = 'aether.db'

/** The old file that the import reads. Aether never writes it. */
export const OLD_WORKSPACE_FILE = 'workspace.json'

export interface Composition {
  /** The controller of each contract in the registry, by contract name. */
  controllers: Record<string, Controller>
  /** The messages about the start. The snapshot of the profiles carries them to the window. */
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
    profiles: new ProfileStore(database),
    imports: new ImportStore(database),
    clock,
    ids,
    file: join(dataDir, OLD_WORKSPACE_FILE)
  })
  if (!imported.ok) notices.push({ code: 'workspace-file-unreadable', message: imported.error.message })

  return ok({
    controllers: {
      [listGithubAccounts.name]: listGithubAccountsController(github),
      [listProfiles.name]: listProfilesController(database, () => notices),
      [chooseDirectories.name]: chooseDirectoriesController(database),
      [addProfile.name]: addProfileController(database, clock, ids),
      [editProfile.name]: editProfileController(database, clock, ids),
      [switchProfile.name]: switchProfileController(database),
      [removeProfile.name]: removeProfileController(database),
      [listSessions.name]: listSessionsController(database),
      [createSession.name]: createSessionController(database, clock, ids),
      [openSession.name]: openSessionController(database),
      [deleteSession.name]: deleteSessionController(database)
    },
    notices,
    close: () => database.close()
  })
}
