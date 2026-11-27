import type { ProfileView } from '../useProfiles'

export function Avatar({ profile, size }: { profile: ProfileView; size: number }) {
  if (profile.github?.avatar) {
    return <img className="avatar" src={profile.github.avatar} width={size} height={size} alt="" />
  }
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function githubNote(profile: ProfileView): string {
  return profile.github ? `@${profile.github.login}` : 'No GitHub account'
}
