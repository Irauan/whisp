import { Check, ChevronsUpDown, Plus, Settings, Users } from 'lucide-react'
import type { ProfileView } from '../useProfiles'
import { Avatar, githubNote } from './Avatar'

const MENU_ID = 'profile-menu'
const closesMenu = { popoverTarget: MENU_ID, popoverTargetAction: 'hide' } as const

interface Props {
  profiles: ProfileView[]
  /** Null when no profile exists. */
  current: ProfileView | null
  onSwitch(profileId: string): void
  onSettings(): void
  onAdd(): void
  onManage(): void
}

export function ProfileSwitcher({ profiles, current, onSwitch, onSettings, onAdd, onManage }: Props) {
  return (
    <div className="account-bar">
      <button type="button" className="row account-button" popoverTarget={MENU_ID}>
        {current && <Avatar profile={current} size={26} />}
        <span className="row-label">{current?.name ?? 'No profile'}</span>
        <span className="row-note">{current?.github && githubNote(current)}</span>
        <ChevronsUpDown size={16} />
      </button>
      <div id={MENU_ID} className="menu" popover="auto" role="group" aria-label="Profiles">
        {current && (
          <>
            <div className="menu-head">
              <Avatar profile={current} size={36} />
              <div>
                <p>{current.github?.name ?? current.name}</p>
                <p className="muted">{githubNote(current)}</p>
              </div>
            </div>
            <hr />
          </>
        )}
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className="row"
            aria-current={profile.id === current?.id ? 'true' : undefined}
            onClick={() => onSwitch(profile.id)}
            {...closesMenu}
          >
            <Avatar profile={profile} size={20} />
            <span className="row-label">{profile.name}</span>
            {profile.id === current?.id && <Check size={16} />}
          </button>
        ))}
        {profiles.length > 0 && <hr />}
        {current && (
          <button type="button" className="row" onClick={onSettings} {...closesMenu}>
            <Settings size={18} />
            <span className="row-label">Profile settings</span>
          </button>
        )}
        <button type="button" className="row" onClick={onAdd} {...closesMenu}>
          <Plus size={18} />
          <span className="row-label">Add profile</span>
        </button>
        <button type="button" className="row" onClick={onManage} {...closesMenu}>
          <Users size={18} />
          <span className="row-label">Manage profiles</span>
        </button>
      </div>
    </div>
  )
}
