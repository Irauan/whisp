import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { listGithubAccounts } from './list-github-accounts.contract'

type Profile = z.output<typeof listGithubAccounts.result>['accounts'][number]

export type FoundAccounts = { ok: true; profiles: Profile[] } | { ok: false; reason: string }

async function read(): Promise<FoundAccounts> {
  try {
    const answer = listGithubAccounts.output.safeParse(await window.aether.invoke(listGithubAccounts.name, {}))
    if (!answer.success) return { ok: false, reason: 'The main process sent an answer that Aether cannot read.' }
    const { data } = answer
    return data.ok ? { ok: true, profiles: data.value.accounts } : { ok: false, reason: data.error.message }
  } catch (cause) {
    return { ok: false, reason: String(cause) }
  }
}

/** Reads the GitHub accounts of the GitHub CLI. `found` is null while a read is in progress. */
export function useGithubAccounts(): { found: FoundAccounts | null; readAgain(): void } {
  const [found, setFound] = useState<FoundAccounts | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setFound(null)
    void read().then((result) => {
      if (active) setFound(result)
    })
    return () => {
      active = false
    }
  }, [attempt])

  return { found, readAgain: () => setAttempt((count) => count + 1) }
}
