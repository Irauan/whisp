import { useEffect, useState } from 'react'
import type { Listing } from '../../shared/bridge'
import type { Attachment, Session } from '../../shared/model'
import type { Mention } from './mention'

const MAX_SHOWN = 20

interface Sources {
  folder: string
  githubLogin: string | null
  sessions: Session[]
}

export interface Suggestions {
  items: Attachment[]
  message: string | null
}

/** Lists the attachments that match the mention. */
export function useSuggestions(mention: Mention | null, sources: Sources): Suggestions | null {
  const { folder, githubLogin, sessions } = sources
  const trigger = mention?.trigger
  const [loaded, setLoaded] = useState<{ key: string; listing: Listing } | null>(null)
  const key = `${trigger} ${githubLogin} ${folder}`

  useEffect(() => {
    if (!folder || (trigger !== '@' && trigger !== '#')) return
    let active = true
    const request =
      trigger === '@'
        ? window.aether.listRepositoryFiles(folder)
        : window.aether.listIssues(folder, githubLogin)
    request
      .catch((cause: unknown): Listing => ({ ok: false, reason: String(cause) }))
      .then((listing) => {
        if (active) setLoaded({ key, listing })
      })
    return () => {
      active = false
    }
  }, [trigger, folder, githubLogin, key])

  if (!mention) return null

  let all: Attachment[]
  if (trigger === '&') {
    all = sessions
      .toReversed()
      .map((session) => ({ kind: 'session', ref: session.id, label: session.title }))
  } else {
    if (!folder) return { items: [], message: 'Choose a folder first.' }
    if (loaded?.key !== key) return { items: [], message: 'Loading…' }
    if (!loaded.listing.ok) return { items: [], message: loaded.listing.reason }
    all = loaded.listing.items
  }

  const needle = mention.query.toLowerCase()
  const items = all
    .filter((item) => item.label.toLowerCase().includes(needle))
    .slice(0, MAX_SHOWN)
  return { items, message: items.length === 0 ? 'No results' : null }
}
