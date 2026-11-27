import { labelOf, MODE_OPTIONS } from '../../../shared/model'
import type { Mode } from '../useProfiles'
import { Menu, MenuOption } from './Menu'

/**
 * The one Mode control of a session (decision 0012). The button shows the label of the mode.
 * The menu has the five modes and nothing else.
 */
export function ModeMenu(props: { mode: Mode; disabled?: boolean; onChange(mode: Mode): void }) {
  return (
    <Menu id="mode-menu" label="Mode" disabled={props.disabled} trigger={labelOf(MODE_OPTIONS, props.mode)}>
      <p className="popover-title">Mode</p>
      {MODE_OPTIONS.map((option) => (
        <MenuOption
          key={option.id}
          menu="mode-menu"
          title={option.label}
          note={option.note}
          checked={props.mode === option.id}
          onSelect={() => props.onChange(option.id)}
        />
      ))}
    </Menu>
  )
}
