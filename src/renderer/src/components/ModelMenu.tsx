import { labelOf, MODELS } from '../../../shared/model'
import { Menu, MenuOption } from './Menu'

type ModelId = (typeof MODELS)[number]['id']

/**
 * The Model control of a session: the button named "Model" shows the label of the model and opens
 * the group "Model". The composer of a new session and the composer of a draft use it. `className`
 * and `above` let the session window show it as a small text button at the bottom of the window.
 */
export function ModelMenu(props: { model: string; disabled?: boolean; above?: boolean; className?: string; onChange(model: ModelId): void }) {
  return (
    <Menu
      id="model-menu"
      label="Model"
      disabled={props.disabled}
      above={props.above}
      {...(props.className === undefined ? {} : { className: props.className })}
      trigger={labelOf(MODELS, props.model)}
    >
      <p className="popover-title">Claude</p>
      {MODELS.map((option) => (
        <MenuOption
          key={option.id}
          menu="model-menu"
          title={option.label}
          checked={props.model === option.id}
          onSelect={() => props.onChange(option.id)}
        />
      ))}
      <hr />
      <MenuOption menu="model-menu" title="ChatGPT" tag="Coming soon" disabled onSelect={() => undefined} />
    </Menu>
  )
}
