import { labelOf, MODE_OPTIONS } from '../../../shared/model'
import type { Mode } from '../useProfiles'
import { Menu, MenuOption } from './Menu'

/**
 * The one Mode control of a session (decision 0012). The button shows the label of the mode.
 * The menu has the five modes and nothing else. `className` and `above` let the session window
 * show it as a small text button at the bottom of the composer, with the menu above it.
 */
export function ModeMenu(props: { mode: Mode; disabled?: boolean; above?: boolean; className?: string; onChange(mode: Mode): void }) {
  return (
    <Menu
      id="mode-menu"
      label="Mode"
      disabled={props.disabled}
      above={props.above}
      {...(props.className === undefined ? {} : { className: props.className })}
      trigger={labelOf(MODE_OPTIONS, props.mode)}
    >
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
