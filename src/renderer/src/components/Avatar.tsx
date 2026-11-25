import type { Account } from '../../../shared/model'

export function Avatar({ account, size }: { account: Account; size: number }) {
  if (account.github?.avatar) {
    return <img className="avatar" src={account.github.avatar} width={size} height={size} alt="" />
  }
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {account.label.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function githubNote(account: Account): string {
  return account.github ? `@${account.github.login}` : 'No GitHub account'
}
