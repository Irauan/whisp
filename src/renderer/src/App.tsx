import { ChevronLeft, ChevronRight, PanelLeft, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog, NewProjectDialog, SearchDialog } from './components/Dialogs'
import { EmptyPage, HomePage, InboxPage, ItemPage, ProjectPage, PullRequestsPage } from './components/Pages'
import { Sidebar } from './components/Sidebar'
import { useNavigation, type View } from './navigation'
import { useWorkspace } from './useWorkspace'

type OpenDialog =
  | { kind: 'new-project' }
  | { kind: 'search' }
  | { kind: 'delete-project'; projectId: string }
  | { kind: 'delete-item'; itemId: string }

const now = () => new Date().toISOString()

export function App() {
  const { workspace, error, dispatch } = useWorkspace()
  const { view, go, back, forward, canGoBack, canGoForward } = useNavigation()
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

  const closeDialog = () => setDialog(null)
  const openNewProject = () => setDialog({ kind: 'new-project' })
  const goFromDialog = (next: View) => {
    closeDialog()
    go(next)
  }

  const addProject = (name: string, path?: string) => {
    const id = crypto.randomUUID()
    dispatch({ type: 'project-added', id, name, path, at: now() })
    closeDialog()
    // From Home, stay on Home so that a typed request is not lost.
    if (view.kind !== 'home') go({ kind: 'project', projectId: id })
  }

  const addItem = (projectId: string, request: { title: string; description: string }) => {
    const id = crypto.randomUUID()
    dispatch({ type: 'item-added', id, projectId, ...request, at: now() })
    go({ kind: 'item', itemId: id })
  }

  const chooseFolder = async (projectId: string) => {
    const path = await window.aether.chooseFolder()
    if (path) dispatch({ type: 'project-folder-set', id: projectId, path })
  }

  // The agent conversations live outside the workspace, so they go separately.
  const forgetRuns = (itemIds: string[]) => {
    for (const itemId of itemIds) void window.aether.forgetAgentRun(itemId).catch(() => undefined)
  }

  const renderPage = () => {
    switch (view.kind) {
      case 'home':
        return (
          <HomePage projects={workspace.projects} onNewProject={openNewProject} onAddItem={addItem} />
        )
      case 'inbox':
        return <InboxPage />
      case 'pulls':
        return <PullRequestsPage />
      case 'project': {
        const project = workspace.projects.find((candidate) => candidate.id === view.projectId)
        if (!project) break
        return (
          <ProjectPage
            project={project}
            items={workspace.workItems.filter((item) => item.projectId === project.id)}
            onAddItem={addItem}
            onGo={go}
            onChooseFolder={() => void chooseFolder(project.id)}
            onDelete={() => setDialog({ kind: 'delete-project', projectId: project.id })}
          />
        )
      }
      case 'item': {
        const item = workspace.workItems.find((candidate) => candidate.id === view.itemId)
        const project = workspace.projects.find((candidate) => candidate.id === item?.projectId)
        if (!item || !project) break
        return (
          <ItemPage
            item={item}
            project={project}
            onMove={(stage) => dispatch({ type: 'item-moved', id: item.id, stage, at: now() })}
            onGo={go}
            onChooseFolder={() => void chooseFolder(project.id)}
            onDelete={() => setDialog({ kind: 'delete-item', itemId: item.id })}
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
      case 'new-project':
        return <NewProjectDialog onClose={closeDialog} onCreate={addProject} />
      case 'search':
        return <SearchDialog workspace={workspace} onClose={closeDialog} onGo={goFromDialog} />
      case 'delete-project': {
        const project = workspace.projects.find((candidate) => candidate.id === dialog.projectId)
        const count = workspace.workItems.filter((item) => item.projectId === dialog.projectId).length
        return (
          <ConfirmDialog
            title={`Delete ${project?.name ?? 'project'}?`}
            body={`This also deletes its work items (${count}). You cannot undo this.`}
            confirmLabel="Delete project"
            onClose={closeDialog}
            onConfirm={() => {
              forgetRuns(
                workspace.workItems.filter((item) => item.projectId === dialog.projectId).map((item) => item.id)
              )
              dispatch({ type: 'project-deleted', id: dialog.projectId })
              goFromDialog({ kind: 'home' })
            }}
          />
        )
      }
      case 'delete-item': {
        const item = workspace.workItems.find((candidate) => candidate.id === dialog.itemId)
        return (
          <ConfirmDialog
            title={`Delete ${item?.title ?? 'work item'}?`}
            body="You cannot undo this."
            confirmLabel="Delete work item"
            onClose={closeDialog}
            onConfirm={() => {
              forgetRuns([dialog.itemId])
              dispatch({ type: 'item-deleted', id: dialog.itemId })
              goFromDialog(item ? { kind: 'project', projectId: item.projectId } : { kind: 'home' })
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
          <Sidebar workspace={workspace} view={view} onGo={go} onNewProject={openNewProject} />
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
