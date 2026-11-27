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
  ProfilesPage
} from './components/Pages'
import { DirectoriesDialog } from './components/DirectoriesDialog'
import { OpenSession } from './components/OpenSession'
import { Sidebar } from './components/Sidebar'
import { ProfileDialog, type ProfileValues } from './components/ProfileDialog'
import { ProfileSwitcher } from './components/ProfileSwitcher'
import { QuestionDialog } from './components/QuestionDialog'
import { sendMessage } from '../../features/sessions/send-message/send-message.contract'
import type { SessionSettings } from '../../shared/model'
import { invokeContract } from './invoke'
import { useNavigation, type View } from './navigation'
import { useProfiles } from './useProfiles'
import { useQuestions } from './useQuestions'

type OpenDialog =
  | { kind: 'search' }
  | { kind: 'add-profile' }
  | { kind: 'profile-settings'; profileId: string }
  | { kind: 'delete-profile'; profileId: string }
  | { kind: 'delete-session'; sessionId: string }

export function App() {
  const { state, error, reload, chooseDirectories, add, edit, switchTo, remove, createSession, deleteSession } = useProfiles()
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

  const { profiles, currentId, notices, sessions, newSessionMode } = state
  const current = profiles.find((profile) => profile.id === currentId) ?? null
  const withoutDirectory = profiles.filter((profile) => profile.workspaceDirectory === null)
  const closeDialog = () => setDialog(null)
  const goFromDialog = (next: View) => {
    closeDialog()
    go(next)
  }

  const openAdd = () => setDialog({ kind: 'add-profile' })

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
            key={current.id}
            sessions={sessions}
            newSessionMode={newSessionMode}
            githubLogin={current.github?.login ?? null}
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
            onClose={closeDialog}
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
          <Sidebar sessions={sessions} view={view} onGo={go} />
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
        <div className="title-strip">{!sidebarOpen && toolbar}</div>
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
