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
  /** Null when the old file had no time. The import then uses the time of the import. */
  createdAt: string | null
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
  // Only the prompt, the account and the folder must exist. The other fields take a default, so
  // that a file from an early version of the old Aether still imports.
  title: z.string().optional(),
  prompt: z.string(),
  settings: z.looseObject({
    folder: z.string(),
    mode: z.string().default('interactive'),
    permissions: z.string().default('ask'),
    model: z.string().default('default'),
    attachments: z.array(attachmentSchema).default([])
  }),
  createdAt: z.string().optional()
})

const profileSchema = z.looseObject({
  accounts: z
    .array(
      z.looseObject({
        id: z.string(),
        label: z.string().trim().min(1),
        github: z
          .looseObject({ login: z.string().min(1), name: z.string().nullish(), avatar: z.string().nullish() })
          .nullish()
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

const firstLine = (text: string) => text.trim().split(/\r?\n/)[0]?.trim() ?? ''

const baseName = (path: string) => path.split(/[\\/]/).findLast(Boolean) ?? path

/** Version 3 kept only the paths of the files of a session. */
function upgradeSession(session: unknown): unknown {
  if (!isRecord(session) || !isRecord(session.settings)) return session
  const { files, ...settings } = session.settings
  // A session without `files` has no attachments, as in the old loader.
  const attachments = (Array.isArray(files) ? files : []).map((path) => ({
    kind: 'file',
    ref: String(path),
    label: baseName(String(path))
  }))
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
      github: github ? { login: github.login, name: github.name ?? null, avatar: github.avatar ?? null } : null
    })),
    currentAccountId: profile.currentAccountId,
    // A session of an account that does not exist cannot show in the old app, so the import skips it.
    drafts: profile.sessions
      .filter((session) => known.has(session.accountId))
      .map(({ accountId, title, prompt, settings, createdAt }) => ({
        accountId,
        // An early version had no title: the first line of the prompt is the title.
        title: title ?? firstLine(prompt),
        prompt,
        mode: modeOf(settings.mode, settings.permissions),
        folder: settings.folder,
        model: settings.model,
        attachments: settings.attachments.map(({ kind, ref, label }) => ({ kind, ref, label })),
        createdAt: createdAt ?? null
      }))
  }
}
