import { ChevronLeft, ChevronRight, PanelLeft, Plus, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog, SearchDialog } from './components/Dialogs'
import {
  BotsPage,
  CustomizePage,
  EmptyPage,
  HomePage,
  ProjectsPage,
  PullRequestsPage,
  WorkItemsPage,
  WorkspacesPage
} from './components/Pages'
import { RootsDialog } from './components/RootsDialog'
import { SessionPage } from './components/SessionPage'
import { Sidebar } from './components/Sidebar'
import { WorkspaceDialog, type WorkspaceValues } from './components/WorkspaceDialog'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { useNavigation, type View } from './navigation'
import { useWorkspaces } from './useWorkspaces'

type OpenDialog =
  | { kind: 'search' }
  | { kind: 'add-workspace' }
  | { kind: 'workspace-settings'; workspaceId: string }
  | { kind: 'delete-workspace'; workspaceId: string }

/** Between story S2 and story S3 of m1-chat, the sessions are the drafts of the import, and they are read-only. */
const NEW_SESSION_UNAVAILABLE = 'Starting a new session is coming soon.'

export function App() {
  const { state, error, chooseRoots, add, edit, switchTo, remove } = useWorkspaces()
  const { view, go, back, forward, reset, canGoBack, canGoForward } = useNavigation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  // View state: the user closed the dialog of the roots for now. It shows again at the next start.
  const [rootsPostponed, setRootsPostponed] = useState(false)
  // View state: the messages of the start that the user closed.
  const [closedNotices, setClosedNotices] = useState<string[]>([])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setDialog((current) => current ?? { kind: 'search' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!state) {
    return (
      <div className="app">
        <main className="main">
          <div className="title-strip" />
          {error && <p className="error" role="alert">{error}</p>}
        </main>
      </div>
    )
  }

  const { workspaces, currentId, notices, sessions } = state
  const current = workspaces.find((workspace) => workspace.id === currentId) ?? null
  const withoutRoot = workspaces.filter((workspace) => workspace.root === null)
  const closeDialog = () => setDialog(null)
  const goFromDialog = (next: View) => {
    closeDialog()
    go(next)
  }

  const openAdd = () => setDialog({ kind: 'add-workspace' })

  const switchWorkspace = async (id: string) => {
    if (id === currentId) return
    // The history belongs to the other workspace.
    if ((await switchTo(id)) === null) reset()
  }

  const saveNew = async (values: WorkspaceValues) => {
    const message = await add(values)
    if (message === null) {
      closeDialog()
      reset()
    }
    return message
  }

  const saveSettings = (workspaceId: string) => async (values: WorkspaceValues) => {
    const message = await edit({ id: workspaceId, ...values })
    if (message === null) closeDialog()
    return message
  }

  const renderPage = () => {
    switch (view.kind) {
      case 'home':
        if (!current) return <NoWorkspace onAdd={openAdd} />
        return (
          <HomePage
            key={current.id}
            sessions={sessions}
            githubLogin={current.github?.login ?? null}
            unavailable={NEW_SESSION_UNAVAILABLE}
            onStart={() => undefined}
          />
        )
      case 'pulls':
        return <PullRequestsPage />
      case 'projects':
        return <ProjectsPage />
      case 'items':
        return <WorkItemsPage />
      case 'bots':
        return <BotsPage />
      case 'customize':
        return <CustomizePage />
      case 'workspaces':
        return (
          <WorkspacesPage
            workspaces={workspaces}
            currentId={currentId}
            onAdd={openAdd}
            onSwitch={(workspaceId) => void switchWorkspace(workspaceId)}
            onEdit={(workspaceId) => setDialog({ kind: 'workspace-settings', workspaceId })}
            onDelete={(workspaceId) => setDialog({ kind: 'delete-workspace', workspaceId })}
          />
        )
      case 'session': {
        const session = sessions.find((candidate) => candidate.id === view.sessionId)
        if (!session) break
        return <SessionPage session={session} />
      }
    }
    return (
      <EmptyPage icon={<SearchX size={36} />} title="Not found" body="This page no longer exists." />
    )
  }

  const renderDialog = () => {
    switch (dialog?.kind) {
      case 'search':
        return <SearchDialog sessions={sessions} onClose={closeDialog} onGo={goFromDialog} />
      case 'add-workspace':
        return <WorkspaceDialog onClose={closeDialog} onSave={saveNew} />
      case 'workspace-settings': {
        const { workspaceId } = dialog
        const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
        if (!workspace) return null
        return <WorkspaceDialog workspace={workspace} onClose={closeDialog} onSave={saveSettings(workspaceId)} />
      }
      case 'delete-workspace': {
        const { workspaceId } = dialog
        const target = workspaces.find((candidate) => candidate.id === workspaceId)
        return (
          <ConfirmDialog
            title={`Remove ${target?.name ?? 'workspace'}?`}
            body="This also deletes its sessions. You cannot undo this. The old files, the GitHub CLI and the Claude folder stay as they are."
            confirmLabel="Remove workspace"
            onClose={closeDialog}
            onConfirm={() => {
              void remove(workspaceId).then((message) => {
                if (message !== null) return
                closeDialog()
                if (workspaceId === currentId) reset()
              })
            }}
          />
        )
      }
      default:
        return null
    }
  }

  const toolbar = (
    <div className="toolbar">
      <button
        type="button"
        className="icon-button"
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <PanelLeft size={18} />
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="icon-button"
        aria-label="Search"
        title="Search (Ctrl+K)"
        onClick={() => setDialog({ kind: 'search' })}
      >
        <Search size={18} />
      </button>
      <button type="button" className="icon-button" aria-label="Back" disabled={!canGoBack} onClick={back}>
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Forward"
        disabled={!canGoForward}
        onClick={forward}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  )

  const shownNotices = notices.filter((notice) => !closedNotices.includes(notice.code))

  return (
    <div className="app">
      {sidebarOpen && (
        <aside className="sidebar">
          {toolbar}
          <Sidebar sessions={sessions} view={view} onGo={go} />
          <WorkspaceSwitcher
            workspaces={workspaces}
            current={current}
            onSwitch={(workspaceId) => void switchWorkspace(workspaceId)}
            onSettings={() => current && setDialog({ kind: 'workspace-settings', workspaceId: current.id })}
            onAdd={openAdd}
            onManage={() => go({ kind: 'workspaces' })}
          />
        </aside>
      )}
      <main className="main">
        <div className="title-strip">{!sidebarOpen && toolbar}</div>
        {error && <p className="error" role="alert">{error}</p>}
        {shownNotices.map((notice) => (
          <p key={notice.code} className="error" role="alert">
            {notice.message}{' '}
            <button type="button" className="link" onClick={() => setClosedNotices([...closedNotices, notice.code])}>
              Close
            </button>
          </p>
        ))}
        <div className="content">{renderPage()}</div>
      </main>
      {renderDialog()}
      {withoutRoot.length > 0 && !rootsPostponed && (
        <RootsDialog
          workspaces={withoutRoot}
          onClose={() => setRootsPostponed(true)}
          onSave={chooseRoots}
        />
      )}
    </div>
  )
}

function NoWorkspace({ onAdd }: { onAdd(): void }) {
  return (
    <EmptyPage
      icon={<Plus size={36} />}
      title="No workspace"
      body="A workspace holds your sessions and has its own root. Add one to start."
      action={
        <button type="button" className="button primary" onClick={onAdd}>
          Add workspace
        </button>
      }
    />
  )
}
