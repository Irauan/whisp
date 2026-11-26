import {
  ArrowUp,
  BookOpen,
  CircleDot,
  CodeXml,
  File,
  Folder,
  FolderGit2,
  GitBranch,
  Laptop,
  MessageSquare,
  Mic,
  Plus,
  ShieldCheck,
  X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import type { FolderInfo } from '../../../shared/bridge'
import {
  baseName,
  labelOf,
  MODELS,
  MODES,
  parseRequest,
  PERMISSIONS,
  type Attachment,
  type SessionSettings
} from '../../../shared/model'
import { findMention, insertTrigger, removeMention, type Edit, type Trigger } from '../mention'
import { useSuggestions } from '../useSuggestions'
import type { SessionDraft } from '../useWorkspaces'
import { AttachmentIcon } from './AttachmentIcon'
import { Menu, MenuOption, Submenu } from './Menu'

const FIRST_SETTINGS: SessionSettings = {
  folder: '',
  mode: 'interactive',
  permissions: 'ask',
  model: 'default',
  checkout: 'worktree',
  attachments: []
}

const IDEAS = [
  { icon: CodeXml, text: 'Review the recent changes and suggest improvements.' },
  { icon: ShieldCheck, text: 'Look for security problems and fix them.' },
  { icon: BookOpen, text: 'Write or update the documentation from the code.' }
]

const MAX_RECENT_FOLDERS = 6

const REFERENCES: { trigger: Trigger; title: string; icon: LucideIcon }[] = [
  { trigger: '@', title: 'Repository file or folder…', icon: FolderGit2 },
  { trigger: '#', title: 'Issue or pull request…', icon: CircleDot },
  { trigger: '&', title: 'Session…', icon: MessageSquare }
]

/** These attachments belong to the repository of the session folder. */
const REPOSITORY_KINDS: Attachment['kind'][] = [
  'repository-file',
  'repository-folder',
  'issue',
  'pull-request'
]

interface Props {
  /** The sessions of the workspace, oldest first. They give the recent folders and the model. */
  sessions: SessionDraft[]
  githubLogin: string | null
  /** Why a new session cannot start, or null. The composer shows it and disables Send. */
  unavailable: string | null
  onSubmit(prompt: string, settings: SessionSettings): void
}

/** The settings of a new session: the folder and the model of the last session. */
function startSettings(last: SessionDraft | undefined): SessionSettings {
  const model = MODELS.find((option) => option.id === last?.model)?.id
  return { ...FIRST_SETTINGS, folder: last?.folder ?? '', model: model ?? FIRST_SETTINGS.model }
}

export function SessionComposer({ sessions, githubLogin, unavailable, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<SessionSettings>(() => startSettings(sessions.at(-1)))
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [chosenFolders, setChosenFolders] = useState<string[]>([])
  const [info, setInfo] = useState<FolderInfo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  const change = (part: Partial<SessionSettings>) =>
    setSettings((current) => ({ ...current, ...part }))

  const { folder } = settings
  useEffect(() => {
    setInfo(null)
    if (!folder) return
    let active = true
    window.aether.inspectFolder(folder).then(
      (result) => {
        if (active) setInfo(result)
      },
      (cause: unknown) => {
        if (active) setProblem(`Aether could not read the folder. ${String(cause)}`)
      }
    )
    return () => {
      active = false
    }
  }, [folder])

  const found = findMention(text, caret)
  const mention = found?.start === dismissed ? null : found
  const suggestions = useSuggestions(mention, { folder, githubLogin, sessions })
  const activeIndex = Math.min(active, Math.max(0, (suggestions?.items.length ?? 0) - 1))

  const recentFolders = [
    ...new Set([...chosenFolders, ...sessions.toReversed().map((session) => session.folder)])
  ].slice(0, MAX_RECENT_FOLDERS)

  // A folder without Git cannot have a worktree.
  const canUseWorktree = Boolean(info?.branch)
  const checkout = canUseWorktree ? settings.checkout : 'folder'
  const ready = unavailable === null && parseRequest(text) !== null && info?.exists === true

  const pickFolder = (path: string) => {
    setProblem(null)
    if (path === folder) return
    setSettings((current) => ({
      ...current,
      folder: path,
      attachments: current.attachments.filter((item) => !REPOSITORY_KINDS.includes(item.kind))
    }))
  }

  const attach = (added: Attachment[]) =>
    setSettings((current) => {
      const known = new Set(current.attachments.map((item) => item.kind + item.ref))
      const fresh = added.filter((item) => !known.has(item.kind + item.ref))
      return { ...current, attachments: [...current.attachments, ...fresh] }
    })

  const applyEdit = (edit: Edit) => {
    flushSync(() => {
      setText(edit.text)
      setCaret(edit.caret)
      setDismissed(null)
      setActive(0)
    })
    textarea.current?.focus()
    textarea.current?.setSelectionRange(edit.caret, edit.caret)
  }

  const startMention = (trigger: Trigger) =>
    applyEdit(insertTrigger(text, textarea.current?.selectionStart ?? text.length, trigger))

  const pickSuggestion = (item: Attachment) => {
    if (!mention) return
    attach([item])
    applyEdit(removeMention(text, caret, mention))
  }

  const chooseFolder = async () => {
    try {
      const path = await window.aether.chooseFolder()
      if (!path) return
      setChosenFolders((current) => [path, ...current])
      pickFolder(path)
    } catch (cause) {
      setProblem(`Aether could not open the folder picker. ${String(cause)}`)
    }
  }

  const addPaths = async (kind: 'file' | 'folder') => {
    try {
      const paths = await (kind === 'file'
        ? window.aether.chooseFiles()
        : window.aether.chooseFolders())
      attach(paths.map((path) => ({ kind, ref: path, label: baseName(path) })))
    } catch (cause) {
      setProblem(`Aether could not open the picker. ${String(cause)}`)
    }
  }

  const submit = () => {
    if (ready) onSubmit(text.trim(), { ...settings, checkout })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (mention && event.key === 'Escape') {
      event.preventDefault()
      setDismissed(mention.start)
      return
    }
    const items = suggestions?.items ?? []
    const chosen = items[activeIndex]
    if (chosen && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((activeIndex + step + items.length) % items.length)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault()
        pickSuggestion(chosen)
        return
      }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const mode = labelOf(MODES, settings.mode)
  const permissions = labelOf(PERMISSIONS, settings.permissions)

  return (
    <>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="composer-box">
          <textarea
            ref={textarea}
            aria-label="Prompt"
            placeholder="Ask anything. Use @ for files, # for issues, & for sessions."
            aria-autocomplete="list"
            aria-controls={mention ? 'suggestions' : undefined}
            aria-activedescendant={
              suggestions?.items.length ? `suggestion-${activeIndex}` : undefined
            }
            rows={3}
            value={text}
            autoFocus
            onChange={(event) => {
              const { value, selectionStart } = event.target
              setText(value)
              setCaret(selectionStart)
              setActive(0)
              if (!findMention(value, selectionStart)) setDismissed(null)
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
          />
          {suggestions && (
            <div id="suggestions" className="suggestions" role="listbox" aria-label="Suggestions">
              {suggestions.items.map((item, index) => (
                <button
                  key={item.kind + item.ref}
                  id={`suggestion-${index}`}
                  ref={
                    index === activeIndex
                      ? (element) => element?.scrollIntoView({ block: 'nearest' })
                      : undefined
                  }
                  type="button"
                  className="row"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  // Keep the focus in the prompt.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickSuggestion(item)}
                >
                  <AttachmentIcon kind={item.kind} size={16} />
                  <span className="row-label">{item.label}</span>
                </button>
              ))}
              {suggestions.message && <p className="empty-row">{suggestions.message}</p>}
            </div>
          )}
          {settings.attachments.length > 0 && (
            <ul className="files" aria-label="Attachments">
              {settings.attachments.map((item) => (
                <li key={item.kind + item.ref} className="file" title={item.ref}>
                  <AttachmentIcon kind={item.kind} size={14} />
                  <span className="row-label">{item.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    onClick={() =>
                      change({
                        attachments: settings.attachments.filter((other) => other !== item)
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="composer-actions session-actions">
            <Menu id="add-menu" label="Add context" above trigger={<Plus size={18} />}>
              {REFERENCES.map((reference) => (
                <MenuOption
                  key={reference.trigger}
                  menu="add-menu"
                  title={reference.title}
                  icon={<reference.icon size={16} />}
                  hint={reference.trigger}
                  onSelect={() => startMention(reference.trigger)}
                />
              ))}
              <hr />
              <MenuOption
                menu="add-menu"
                title="Files…"
                icon={<File size={16} />}
                onSelect={() => void addPaths('file')}
              />
              <MenuOption
                menu="add-menu"
                title="Folder…"
                icon={<Folder size={16} />}
                onSelect={() => void addPaths('folder')}
              />
            </Menu>
            <Menu
              id="mode-menu"
              label="Mode and tool permissions"
              trigger={settings.permissions === 'ask' ? mode : `${mode} · ${permissions}`}
            >
              <p className="popover-title">Mode</p>
              {MODES.map((option) => (
                <MenuOption
                  key={option.id}
                  menu="mode-menu"
                  title={option.label}
                  note={option.note}
                  checked={settings.mode === option.id}
                  onSelect={() => change({ mode: option.id })}
                />
              ))}
              <hr />
              <Submenu id="permissions-menu" label="Tool permissions" value={permissions}>
                {PERMISSIONS.map((option) => (
                  <MenuOption
                    key={option.id}
                    menu="mode-menu"
                    title={option.label}
                    note={option.note}
                    checked={settings.permissions === option.id}
                    onSelect={() => change({ permissions: option.id })}
                  />
                ))}
              </Submenu>
            </Menu>
            <Menu id="model-menu" label="Model" trigger={labelOf(MODELS, settings.model)}>
              <p className="popover-title">Claude</p>
              {MODELS.map((option) => (
                <MenuOption
                  key={option.id}
                  menu="model-menu"
                  title={option.label}
                  checked={settings.model === option.id}
                  onSelect={() => change({ model: option.id })}
                />
              ))}
              <hr />
              <MenuOption
                menu="model-menu"
                title="ChatGPT"
                tag="Coming soon"
                disabled
                onSelect={() => undefined}
              />
            </Menu>
            <span className="spacer" />
            <span title="Voice input: coming soon">
              <button type="button" className="icon-button" aria-label="Voice input, coming soon" disabled>
                <Mic size={18} />
              </button>
            </span>
            <button type="submit" className="send" aria-label="Start session" disabled={!ready}>
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
        <div className="composer-bar">
          <Menu
            id="folder-menu"
            label={folder || 'Choose a folder'}
            trigger={
              <>
                <Folder size={16} />
                <span className="bar-label">{folder ? baseName(folder) : 'Choose a folder'}</span>
              </>
            }
          >
            <p className="popover-title">The session runs in this folder</p>
            {recentFolders.map((path) => (
              <MenuOption
                key={path}
                menu="folder-menu"
                title={baseName(path)}
                note={path}
                checked={path === folder}
                onSelect={() => pickFolder(path)}
              />
            ))}
            {recentFolders.length > 0 && <hr />}
            <MenuOption
              menu="folder-menu"
              title="Choose a folder…"
              onSelect={() => void chooseFolder()}
            />
          </Menu>
          <Menu
            id="place-menu"
            label="Where the session runs"
            trigger={
              <>
                <Laptop size={16} />
                This computer
              </>
            }
          >
            <MenuOption menu="place-menu" title="This computer" checked onSelect={() => undefined} />
            <MenuOption
              menu="place-menu"
              title="Cloud"
              tag="Coming soon"
              disabled
              onSelect={() => undefined}
            />
          </Menu>
          <Menu
            id="checkout-menu"
            label="Worktree"
            disabled={!info?.exists}
            trigger={
              <>
                <GitBranch size={16} />
                <span className="bar-label">
                  {checkout === 'worktree' ? 'New worktree' : (info?.branch ?? 'Folder as it is')}
                </span>
              </>
            }
          >
            <MenuOption
              menu="checkout-menu"
              title="New worktree"
              note={
                canUseWorktree
                  ? 'Work on a separate copy of the repository'
                  : 'The folder is not a Git repository with a commit'
              }
              checked={checkout === 'worktree'}
              disabled={!canUseWorktree}
              onSelect={() => change({ checkout: 'worktree' })}
            />
            <MenuOption
              menu="checkout-menu"
              title="Folder as it is"
              note={info?.branch ? `Work on the branch ${info.branch}` : 'Work in the folder'}
              checked={checkout === 'folder'}
              onSelect={() => change({ checkout: 'folder' })}
            />
          </Menu>
        </div>
        {(problem || info?.exists === false) && (
          <p className="error composer-error" role="alert">
            {problem ?? 'This folder no longer exists. Choose a different folder.'}
          </p>
        )}
        {unavailable && <p className="muted composer-error">{unavailable}</p>}
      </form>
      <div className="ideas">
        {IDEAS.map((idea) => (
          <button
            key={idea.text}
            type="button"
            className="idea"
            onClick={() => {
              applyEdit({ text: idea.text, caret: idea.text.length })
            }}
          >
            <idea.icon size={18} />
            {idea.text}
          </button>
        ))}
      </div>
    </>
  )
}
