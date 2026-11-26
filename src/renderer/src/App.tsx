import { ChevronLeft, ChevronRight, PanelLeft, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  contentOf,
  currentAccount,
  type GithubProfile,
  type SessionSettings
} from '../../shared/model'
import { AccountDialog } from './components/AccountDialog'
import { AccountSwitcher } from './components/AccountSwitcher'
import { ConfirmDialog, SearchDialog } from './components/Dialogs'
import {
  AccountsPage,
  BotsPage,
  CustomizePage,
  EmptyPage,
  HomePage,
  ProjectsPage,
  PullRequestsPage,
  WorkItemsPage
} from './components/Pages'
import { SessionPage } from './components/SessionPage'
import { Sidebar } from './components/Sidebar'
import { useNavigation, type View } from './navigation'
import { useWorkspace } from './useWorkspace'

type OpenDialog =
  | { kind: 'search' }
  | { kind: 'add-account' }
  | { kind: 'edit-account'; accountId: string }
  | { kind: 'delete-account'; accountId: string }
  | { kind: 'delete-session'; sessionId: string }

const now = () => new Date().toISOString()

export function App() {
  const { workspace, error, dispatch } = useWorkspace()
  const { view, go, back, forward, reset, canGoBack, canGoForward } = useNavigation()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setDialog((current) => current ?? { kind: 'search' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!workspace) {
    return (
      <div className="app">
        <main className="main">
          <div className="title-strip" />
          {error && <p className="error" role="alert">{error}</p>}
        </main>
      </div>
    )
  }

  const account = currentAccount(workspace)
  // Show only the current account, so that the accounts stay apart.
  const content = contentOf(workspace, account.id)
  const closeDialog = () => setDialog(null)
  const goFromDialog = (next: View) => {
    closeDialog()
    go(next)
  }

  const openAddAccount = () => setDialog({ kind: 'add-account' })

  const addAccount = (label: string, github: GithubProfile | null) => {
    dispatch({ type: 'account-added', id: crypto.randomUUID(), label, github })
    closeDialog()
    reset()
  }

  const switchAccount = (id: string) => {
    if (id === account.id) return
    dispatch({ type: 'account-switched', id })
    // The history belongs to the other account.
    reset()
  }

  const addSession = (prompt: string, settings: SessionSettings) => {
    const id = crypto.randomUUID()
    dispatch({ type: 'session-added', id, prompt, settings, at: now() })
    go({ kind: 'session', sessionId: id })
  }

  const renderPage = () => {
    switch (view.kind) {
      case 'home':
        return (
          <HomePage
            key={account.id}
            sessions={content.sessions}
            githubLogin={account.github?.login ?? null}
            onStart={addSession}
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
      case 'accounts':
        return (
          <AccountsPage
            workspace={workspace}
            onAdd={openAddAccount}
            onSwitch={switchAccount}
            onEdit={(accountId) => setDialog({ kind: 'edit-account', accountId })}
            onDelete={(accountId) => setDialog({ kind: 'delete-account', accountId })}
          />
        )
      case 'session': {
        const session = content.sessions.find((candidate) => candidate.id === view.sessionId)
        if (!session) break
        return (
          <SessionPage
            session={session}
            onDelete={() => setDialog({ kind: 'delete-session', sessionId: session.id })}
          />
        )
      }
    }
    return (
      <EmptyPage icon={<SearchX size={36} />} title="Not found" body="This page no longer exists." />
    )
  }

  const renderDialog = () => {
    switch (dialog?.kind) {
      case 'search':
        return <SearchDialog content={content} onClose={closeDialog} onGo={goFromDialog} />
      case 'add-account':
        return <AccountDialog onClose={closeDialog} onSave={addAccount} />
      case 'edit-account': {
        const { accountId } = dialog
        return (
          <AccountDialog
            account={workspace.accounts.find((candidate) => candidate.id === accountId)}
            onClose={closeDialog}
            onSave={(label, github) => {
              dispatch({ type: 'account-edited', id: accountId, label, github })
              closeDialog()
            }}
          />
        )
      }
      case 'delete-account': {
        const { accountId } = dialog
        const target = workspace.accounts.find((candidate) => candidate.id === accountId)
        const { sessions } = contentOf(workspace, accountId)
        return (
          <ConfirmDialog
            title={`Remove ${target?.label ?? 'account'}?`}
            body={`This also deletes its sessions (${sessions.length}). You cannot undo this. The GitHub CLI stays signed in.`}
            confirmLabel="Remove account"
            onClose={closeDialog}
            onConfirm={() => {
              dispatch({ type: 'account-deleted', id: accountId })
              closeDialog()
              if (accountId === account.id) reset()
            }}
          />
        )
      }
      case 'delete-session': {
        const { sessionId } = dialog
        const session = content.sessions.find((candidate) => candidate.id === sessionId)
        return (
          <ConfirmDialog
            title={`Delete ${session?.title ?? 'session'}?`}
            body="You cannot undo this."
            confirmLabel="Delete session"
            onClose={closeDialog}
            onConfirm={() => {
              dispatch({ type: 'session-deleted', id: sessionId })
              goFromDialog({ kind: 'home' })
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

  return (
    <div className="app">
      {sidebarOpen && (
        <aside className="sidebar">
          {toolbar}
          <Sidebar content={content} view={view} onGo={go} />
          <AccountSwitcher
            accounts={workspace.accounts}
            current={account}
            onSwitch={switchAccount}
            onAdd={openAddAccount}
            onManage={() => go({ kind: 'accounts' })}
          />
        </aside>
      )}
      <main className="main">
        <div className="title-strip">{!sidebarOpen && toolbar}</div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="content">{renderPage()}</div>
      </main>
      {renderDialog()}
    </div>
  )
}
