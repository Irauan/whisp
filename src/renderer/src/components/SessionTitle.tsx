import { Archive, ChevronDown, GitBranch, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { renameSession } from '../../../features/sessions/rename/rename.contract'
import { invokeContract } from '../invoke'
import { Menu, MenuOption } from './Menu'

const MENU_ID = 'session-menu'

/** The title that a draft shows (spec S10, "Screens"). A draft has no title from the agent. */
export const DRAFT_TITLE = 'New session'

/**
 * The title of the open session and its menu, in the title strip (story S10). The title is plain text:
 * only the arrow opens the menu. "Rename" turns the title into a text field in place. Enter saves,
 * and Escape or a click outside cancels. A blank title is refused, so the field stays. A shortcut letter
 * runs its item while the menu is open. A draft has one item only: "Discard draft", with no letter.
 * The main process owns the title: the window shows the title that the event `title` brings.
 */
export function SessionTitle({
  sessionId,
  title,
  draft,
  onDelete,
  onProblem
}: {
  sessionId: string
  title: string
  draft: boolean
  onDelete(): void
  /** Shows the text of a command that failed. */
  onProblem(message: string): void
}) {
  const root = useRef<HTMLDivElement>(null)
  // View state: whether the title is a text field now.
  const [renaming, setRenaming] = useState(false)

  const shown = draft ? DRAFT_TITLE : title
  const arrow = () => root.current?.querySelector<HTMLButtonElement>('button[aria-label="Session options"]') ?? null

  const rename = () => {
    setRenaming(true)
  }

  // A shortcut letter runs its item while the menu is open. The menu closes first, as for a click.
  // A draft has no letter: its one item, "Discard draft", has none in the mockup.
  useEffect(() => {
    if (draft) return
    const shortcuts: Record<string, () => void> = { r: rename, d: onDelete }
    const onKeyDown = (event: KeyboardEvent) => {
      const menu = document.getElementById(MENU_ID)
      if (!menu?.matches(':popover-open') || event.ctrlKey || event.metaKey || event.altKey) return
      const run = shortcuts[event.key.toLowerCase()]
      if (!run) return
      event.preventDefault()
      menu.hidePopover()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [draft, onDelete])

  return (
    <div ref={root} className="strip-title">
      {renaming ? (
        <TitleField
          initial={title}
          onSave={async (value) => {
            const result = await invokeContract(renameSession, { id: sessionId, title: value })
            // A blank title keeps the field: the user can type another title.
            if (!result.ok && result.error.code === 'blank-title') return false
            if (!result.ok) onProblem(result.error.message)
            return true
          }}
          onClose={() => {
            setRenaming(false)
            // Focus goes back to the arrow, which the field replaced as the place of the keyboard.
            queueMicrotask(() => arrow()?.focus())
          }}
        />
      ) : (
        <h1 className="session-title" title={shown}>
          {shown}
        </h1>
      )}
      <Menu id={MENU_ID} label="Session options" className="icon-button strip-arrow" menuClass="session-menu" trigger={<ChevronDown size={14} />}>
        {draft ? (
          <MenuOption menu={MENU_ID} title="Discard draft" icon={<Trash2 size={16} />} danger onSelect={onDelete} />
        ) : (
          <>
            <MenuOption menu={MENU_ID} title="Rename" icon={<Pencil size={16} />} hint="R" onSelect={rename} />
            <MenuOption menu={MENU_ID} title="Fork" icon={<GitBranch size={16} />} tag="Coming soon" disabled onSelect={() => undefined} />
            <hr />
            <MenuOption menu={MENU_ID} title="Archive" icon={<Archive size={16} />} tag="Coming soon" disabled onSelect={() => undefined} />
            <MenuOption menu={MENU_ID} title="Delete" icon={<Trash2 size={16} />} hint="D" danger onSelect={onDelete} />
          </>
        )}
      </Menu>
    </div>
  )
}

/**
 * The text field of Rename. It starts with the title selected. `onSave` answers false when the title is
 * refused, and the field stays. The field closes itself once, by Enter, Escape or a click outside.
 */
function TitleField({ initial, onSave, onClose }: { initial: string; onSave(value: string): Promise<boolean>; onClose(): void }) {
  const field = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  const [value, setValue] = useState(initial)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  const close = () => {
    if (closed.current) return
    closed.current = true
    onClose()
  }

  const save = async () => {
    if (closed.current) return
    if (value.trim() === '') {
      setRefused(true)
      return
    }
    if (await onSave(value)) close()
    else setRefused(true)
  }

  return (
    <input
      ref={field}
      className="session-title-field"
      aria-label="Session title"
      aria-invalid={refused || undefined}
      value={value}
      onChange={(event) => {
        setValue(event.target.value)
        setRefused(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void save()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          close()
        }
      }}
      onBlur={close}
    />
  )
}
