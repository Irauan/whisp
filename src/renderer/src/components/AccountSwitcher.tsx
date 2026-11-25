import { Check, ChevronsUpDown, Plus, Users } from 'lucide-react'
import type { Account } from '../../../shared/model'
import { Avatar, githubNote } from './Avatar'

const MENU_ID = 'account-menu'
const closesMenu = { popoverTarget: MENU_ID, popoverTargetAction: 'hide' } as const

interface Props {
  accounts: Account[]
  current: Account
  onSwitch(accountId: string): void
  onAdd(): void
  onManage(): void
}

export function AccountSwitcher({ accounts, current, onSwitch, onAdd, onManage }: Props) {
  return (
    <div className="account-bar">
      <button type="button" className="row account-button" popoverTarget={MENU_ID}>
        <Avatar account={current} size={26} />
        <span className="row-label">{current.label}</span>
        <span className="row-note">{current.github && githubNote(current)}</span>
        <ChevronsUpDown size={16} />
      </button>
      <div id={MENU_ID} className="menu" popover="auto" role="group" aria-label="Accounts">
        <div className="menu-head">
          <Avatar account={current} size={36} />
          <div>
            <p>{current.github?.name ?? current.label}</p>
            <p className="muted">{githubNote(current)}</p>
          </div>
        </div>
        <hr />
        {accounts.map((account) => (
          <button
            key={account.id}
            type="button"
            className="row"
            aria-current={account.id === current.id ? 'true' : undefined}
            onClick={() => onSwitch(account.id)}
            {...closesMenu}
          >
            <Avatar account={account} size={20} />
            <span className="row-label">{account.label}</span>
            {account.id === current.id && <Check size={16} />}
          </button>
        ))}
        <hr />
        <button type="button" className="row" onClick={onAdd} {...closesMenu}>
          <Plus size={18} />
          <span className="row-label">Add account</span>
        </button>
        <button type="button" className="row" onClick={onManage} {...closesMenu}>
          <Users size={18} />
          <span className="row-label">Manage accounts</span>
        </button>
      </div>
    </div>
  )
}
