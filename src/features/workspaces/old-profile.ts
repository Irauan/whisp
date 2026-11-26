import { z } from 'zod'
import type { Mode } from '../../building-blocks/mode'
import type { GithubAccount } from './workspace'

/**
 * The reader of the old `workspace.json` (versions 1 to 4), for the import (decision 0003, 0005).
 * It is pure. It reads what the old Aether wrote. The old projects and work items are not read.
 */

export interface OldAccount {
  id: string
  label: string
  github: GithubAccount | null
}

/** A session draft of the old file, with the old mode and permissions already mapped to a mode. */
export interface OldDraft {
  accountId: string
  title: string
  prompt: string
  mode: Mode
  folder: string
  model: string
  attachments: { kind: string; ref: string; label: string }[]
  createdAt: string
}

export interface OldProfile {
  accounts: OldAccount[]
  currentAccountId: string
  drafts: OldDraft[]
}

/**
 * The import order of the brief: Plan to Plan, Autopilot to Auto, Approve all to Approve all,
 * Assisted to Auto, else Ask. The first match wins.
 * @param mode The old mode: `interactive`, `plan` or `autopilot`.
 * @param permissions The old tool permissions: `ask`, `assisted` or `all`.
 */
export function modeOf(mode: string, permissions: string): Mode {
  if (mode === 'plan') return 'plan'
  if (mode === 'autopilot') return 'auto'
  if (permissions === 'all') return 'approve-all'
  if (permissions === 'assisted') return 'auto'
  return 'ask'
}

const attachmentSchema = z.looseObject({ kind: z.string(), ref: z.string(), label: z.string() })

const draftSchema = z.looseObject({
  accountId: z.string(),
  title: z.string(),
  prompt: z.string(),
  settings: z.looseObject({
    folder: z.string(),
    mode: z.string(),
    permissions: z.string(),
    model: z.string(),
    attachments: z.array(attachmentSchema)
  }),
  createdAt: z.string()
})

const profileSchema = z.looseObject({
  accounts: z
    .array(
      z.looseObject({
        id: z.string(),
        label: z.string().trim().min(1),
        github: z.looseObject({ login: z.string().min(1), name: z.string().nullish(), avatar: z.string().nullish() }).nullable()
      })
    )
    .min(1),
  currentAccountId: z.string(),
  projects: z.array(z.unknown()),
  workItems: z.array(z.unknown()),
  sessions: z.array(draftSchema)
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const baseName = (path: string) => path.split(/[\\/]/).findLast(Boolean) ?? path

/** Version 3 kept only the paths of the files of a session. */
function upgradeSession(session: unknown): unknown {
  if (!isRecord(session) || !isRecord(session.settings)) return session
  const { files, ...settings } = session.settings
  if (!Array.isArray(files)) return session
  const attachments = files.map((path) => ({ kind: 'file', ref: String(path), label: baseName(String(path)) }))
  return { ...session, settings: { ...settings, attachments } }
}

/** Brings a file of version 1 to 3 to the shape of version 4. Version 1 had no accounts, so it has the first one. */
function upgrade(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.version === 4) return value
  if (value.version === 3 && Array.isArray(value.sessions)) {
    return { ...value, sessions: value.sessions.map(upgradeSession) }
  }
  if (value.version === 2) return { ...value, sessions: [] }
  if (value.version === 1 && Array.isArray(value.projects)) {
    return {
      accounts: [{ id: 'personal', label: 'Personal', github: null }],
      currentAccountId: 'personal',
      projects: value.projects,
      workItems: Array.isArray(value.workItems) ? value.workItems : [],
      sessions: []
    }
  }
  return null
}

/**
 * Reads the text of a `workspace.json`. Returns null when Aether cannot read it: this includes
 * text that is not JSON, an unknown version, and any field that has the wrong type. The caller
 * then keeps the file and shows a message. A file is never read as empty.
 */
export function readOldProfile(text: string): OldProfile | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = profileSchema.safeParse(upgrade(data))
  if (!parsed.success) return null
  const profile = parsed.data
  if (!profile.accounts.some((account) => account.id === profile.currentAccountId)) return null

  const known = new Set(profile.accounts.map((account) => account.id))
  return {
    accounts: profile.accounts.map(({ id, label, github }) => ({
      id,
      label: label.trim(),
      github: github && { login: github.login, name: github.name ?? null, avatar: github.avatar ?? null }
    })),
    currentAccountId: profile.currentAccountId,
    // A session of an account that does not exist cannot show in the old app, so the import skips it.
    drafts: profile.sessions
      .filter((session) => known.has(session.accountId))
      .map(({ accountId, title, prompt, settings, createdAt }) => ({
        accountId,
        title,
        prompt,
        mode: modeOf(settings.mode, settings.permissions),
        folder: settings.folder,
        model: settings.model,
        attachments: settings.attachments.map(({ kind, ref, label }) => ({ kind, ref, label })),
        createdAt
      }))
  }
}
