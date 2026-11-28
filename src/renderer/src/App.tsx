import { ChevronLeft, ChevronRight, PanelLeft, Plus, Search, SearchX } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ConfirmDialog, SearchDialog } from './components/Dialogs'
import {
  BotsPage,
  CustomizePage,
  EmptyPage,
  HomePage,
  ProjectsPage,
  PullRequestsPage,
  WorkItemsPage,
  ProfilesPage
} from './components/Pages'
import { DirectoriesDialog } from './components/DirectoriesDialog'
import { OpenSession } from './components/OpenSession'
import { Sidebar } from './components/Sidebar'
import { ProfileDialog, type ProfileValues } from './components/ProfileDialog'
import { ProfileSwitcher } from './components/ProfileSwitcher'
import { QuestionDialog } from './components/QuestionDialog'
import { focusSessionOptions } from './components/SessionTitle'
import { SESSIONS_CHANGED, sessionEventSchema } from '../../features/sessions/open/open.contract'
import { sendMessage } from '../../features/sessions/send-message/send-message.contract'
import { setViewing } from '../../features/sessions/set-viewing/set-viewing.contract'
import type { SessionSettings } from '../../shared/model'
import { invokeContract } from './invoke'
import { useNavigation, type View } from './navigation'
import { applySidebarEvent, replaySidebarEvents } from './sidebar-state'
import type { SessionEvent } from './session-view'
import { useProfiles, type SessionView } from './useProfiles'
import { useQuestions } from './useQuestions'

type OpenDialog =
  | { kind: 'search' }
  | { kind: 'add-profile' }
  | { kind: 'profile-settings'; profileId: string }
  | { kind: 'delete-profile'; profileId: string }
  | { kind: 'delete-session'; sessionId: string }

export function App() {
  const { state, error, reload, chooseDirectories, add, edit, switchTo, remove, createSession, deleteSession, addFolder, removeFolder, setCollapsed } =
    useProfiles()
  const { view, go, back, forward, reset, canGoBack, canGoForward } = useNavigation()
  // The questions of the main process (trust and directory). The window shows the oldest one.
  const { questions, answer: answerQuestion } = useQuestions()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  // View state: the user closed the dialog of the directories for now. It shows again at the next start.
  const [directoriesPostponed, setDirectoriesPostponed] = useState(false)
  // View state: the text of the last command that failed, or null.
  const [problem, setProblem] = useState<string | null>(null)
  // View state: the messages of the start that the user closed.
  const [closedNotices, setClosedNotices] = useState<string[]>([])
  // View state: the place of the session title in the title strip. The open session draws its title there.
  const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null)

  // The session that the window shows. The main process needs it for the unread mark (story S11). The
  // layout effect sends it before the next event of the user, at the start too, also after a reload of the page.
  const viewedId = view.kind === 'session' ? view.sessionId : null
  useLayoutEffect(() => {
    void invokeContract(setViewing, { sessionId: viewedId }).then((sent) => {
      if (!sent.ok) console.error('Aether could not tell the main process which session is open.', sent.error.message)
    })
  }, [viewedId])

  // The sidebar map: the live state of every session, by ID (story S11). It starts from `sessions.list`.
  // The events of `sessions.changed` keep it up to date, in the order of the revision. A gap loads the list again.
  const [live, setLive] = useState<{ source: SessionView[] | null; items: ReadonlyMap<string, SessionView> }>({ source: null, items: new Map() })
  const liveRef = useRef(live)
  // The latest events. A new list replays those that are newer than its items, because an event can come before its list.
  const recentEvents = useRef<SessionEvent[]>([])
  const sessionList = state?.sessions ?? null
  useLayoutEffect(() => {
    if (sessionList === null) return
    const replayed = replaySidebarEvents(new Map(sessionList.map((session) => [session.id, session])), recentEvents.current)
    liveRef.current = { source: sessionList, items: replayed.items }
    setLive(liveRef.current)
    // A gap in the replay loads the list again, as a gap in the live path does.
    if (replayed.gap) void reload()
  }, [sessionList, reload])
  useEffect(
    () =>
      window.aether.subscribe(SESSIONS_CHANGED, (payload) => {
        const event = sessionEventSchema.safeParse(payload)
        if (!event.success) return
        recentEvents.current = [...recentEvents.current.slice(-499), event.data]
        // A new title of any session changes its row, also when the session is not open. The main process saves
        // the title before it sends the event, so the new list holds it (story S10).
        if (event.data.change.type === 'title') void reload()
        const next = applySidebarEvent(liveRef.current.items, event.data)
        if (next === null) {
          void reload()
          return
        }
        if (next !== liveRef.current.items) {
          liveRef.current = { source: liveRef.current.source, items: next }
          setLive(liveRef.current)
        }
      }),
    [reload]
  )

  // Rule 9: a collapsed group expands when the user opens one of its sessions. It runs when the open
  // session changes, never as a constant rule: the user can collapse the group of the open session.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  useEffect(() => {
    if (viewedId === null) return
    const snapshot = stateRef.current
    const session = snapshot?.sessions.find((candidate) => candidate.id === viewedId)
    const folder = snapshot?.folders.find((candidate) => candidate.path === session?.sourcePath)
    if (folder?.collapsed) setCollapsed(folder.id, false)
  }, [viewedId, setCollapsed])

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

  const { profiles, currentId, notices, sessions, folders, newSessionMode } = state
  // The rows of the sidebar take the live state from the map, as long as the map matches the list.
  const liveSessions = live.source === sessions ? sessions.map((session) => live.items.get(session.id) ?? session) : sessions
  const current = profiles.find((profile) => profile.id === currentId) ?? null
  const withoutDirectory = profiles.filter((profile) => profile.workspaceDirectory === null)
  const closeDialog = () => setDialog(null)
  const goFromDialog = (next: View) => {
    closeDialog()
    go(next)
  }

  const openAdd = () => setDialog({ kind: 'add-profile' })

  // "Add local folder or repository": the picker, then the folder joins the sidebar. A cancel changes nothing.
  const addLocalFolder = async () => {
    if (!current) return
    let path: string | null
    try {
      path = await window.aether.chooseFolder()
    } catch (cause) {
      setProblem(`Aether could not open the folder picker. ${String(cause)}`)
      return
    }
    if (path !== null) setProblem(await addFolder(current.id, path))
  }

  const switchProfile = async (id: string) => {
    if (id === currentId) return
    // The history belongs to the other profile.
    if ((await switchTo(id)) === null) reset()
  }

  const saveNew = async (values: ProfileValues) => {
    const message = await add(values)
    if (message === null) {
      closeDialog()
      reset()
    }
    return message
  }

  const saveSettings = (profileId: string) => async (values: ProfileValues) => {
    const message = await edit({ id: profileId, ...values })
    if (message === null) closeDialog()
    return message
  }

  const startSession = (profileId: string) => async (prompt: string, settings: SessionSettings) => {
    const created = await createSession({
      profileId,
      prompt,
      mode: settings.mode,
      model: settings.model,
      sourcePath: settings.folder,
      attachments: settings.attachments
    })
    if ('message' in created) return created.message
    // Flow 2: the session window opens, and the prompt goes as the first message. The session exists
    // already, so a refusal leaves a draft with its prompt. The window of the draft shows it.
    const sent = await invokeContract(sendMessage, { id: created.id, text: prompt })
    go({ kind: 'session', sessionId: created.id })
    setProblem(sent.ok ? null : sent.error.message)
    return null
  }

  const renderPage = () => {
    switch (view.kind) {
      case 'home':
        if (!current) return <NoProfile onAdd={openAdd} />
        return (
          <HomePage
            key={`${current.id}:${view.folder ?? ''}`}
            sessions={sessions}
            newSessionMode={newSessionMode}
            githubLogin={current.github?.login ?? null}
            folder={view.folder}
            onStart={startSession(current.id)}
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
      case 'profiles':
        return (
          <ProfilesPage
            profiles={profiles}
            currentId={currentId}
            onAdd={openAdd}
            onSwitch={(profileId) => void switchProfile(profileId)}
            onEdit={(profileId) => setDialog({ kind: 'profile-settings', profileId })}
            onDelete={(profileId) => setDialog({ kind: 'delete-profile', profileId })}
          />
        )
      case 'session':
        return (
          <OpenSession
            key={view.sessionId}
            id={view.sessionId}
            asking={questions.some((question) => question.sessionId === view.sessionId)}
            stripSlot={stripSlot}
            onSettingsSaved={() => void reload()}
            onDelete={() => setDialog({ kind: 'delete-session', sessionId: view.sessionId })}
          />
        )
    }
    return (
      <EmptyPage icon={<SearchX size={36} />} title="Not found" body="This page no longer exists." />
    )
  }

  const renderDialog = () => {
    switch (dialog?.kind) {
      case 'search':
        return <SearchDialog sessions={sessions} onClose={closeDialog} onGo={goFromDialog} />
      case 'add-profile':
        return <ProfileDialog onClose={closeDialog} onSave={saveNew} />
      case 'profile-settings': {
        const { profileId } = dialog
        const profile = profiles.find((candidate) => candidate.id === profileId)
        if (!profile) return null
        return <ProfileDialog profile={profile} onClose={closeDialog} onSave={saveSettings(profileId)} />
      }
      case 'delete-session': {
        const { sessionId } = dialog
        const target = sessions.find((candidate) => candidate.id === sessionId)
        return (
          <ConfirmDialog
            title={`Delete ${target ? `"${target.title}"` : 'this session'}?`}
            body="You cannot undo this. The old files of Aether stay as they are."
            confirmLabel="Delete session"
            // After Cancel the focus goes back to the arrow "Session options", where the user chose "Delete".
            onClose={() => {
              closeDialog()
              // The modal dialog keeps the page inert until React removes it, so the focus moves after that.
              setTimeout(focusSessionOptions, 0)
            }}
            onConfirm={() => {
              void deleteSession(sessionId).then((message) => {
                closeDialog()
                setProblem(message)
                if (message === null) go({ kind: 'home' })
              })
            }}
          />
        )
      }
      case 'delete-profile': {
        const { profileId } = dialog
        const target = profiles.find((candidate) => candidate.id === profileId)
        return (
          <ConfirmDialog
            title={`Remove ${target?.name ?? 'profile'}?`}
            body="This also deletes its sessions. You cannot undo this. The old files, the GitHub CLI and the Claude folder stay as they are."
            confirmLabel="Remove profile"
            onClose={closeDialog}
            onConfirm={() => {
              void remove(profileId).then((message) => {
                if (message !== null) return
                closeDialog()
                if (profileId === currentId) reset()
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
          <Sidebar
            sessions={liveSessions}
            folders={folders}
            askingIds={new Set(questions.map((question) => question.sessionId))}
            view={view}
            onGo={go}
            onToggleFolder={setCollapsed}
            onAddFolder={() => void addLocalFolder()}
            onRemoveFolder={(folderId) => void removeFolder(folderId).then(setProblem)}
          />
          <ProfileSwitcher
            profiles={profiles}
            current={current}
            onSwitch={(profileId) => void switchProfile(profileId)}
            onSettings={() => current && setDialog({ kind: 'profile-settings', profileId: current.id })}
            onAdd={openAdd}
            onManage={() => go({ kind: 'profiles' })}
          />
        </aside>
      )}
      <main className="main">
        <div className="title-strip">
          {!sidebarOpen && toolbar}
          <div className="strip-slot" ref={setStripSlot} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {problem && (
          <p className="error" role="alert">
            {problem}{' '}
            <button type="button" className="link" onClick={() => setProblem(null)}>
              Close
            </button>
          </p>
        )}
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
      {questions[0] && (
        <QuestionDialog key={questions[0].id} question={questions[0]} onAnswer={(answer) => answerQuestion(questions[0]!, answer)} />
      )}
      {withoutDirectory.length > 0 && !directoriesPostponed && (
        <DirectoriesDialog
          profiles={withoutDirectory}
          onClose={() => setDirectoriesPostponed(true)}
          onSave={chooseDirectories}
        />
      )}
    </div>
  )
}

function NoProfile({ onAdd }: { onAdd(): void }) {
  return (
    <EmptyPage
      icon={<Plus size={36} />}
      title="No profile"
      body="A profile holds your sessions and has its own workspace directory. Add one to start."
      action={
        <button type="button" className="button primary" onClick={onAdd}>
          Add profile
        </button>
      }
    />
  )
}
