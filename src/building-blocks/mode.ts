/**
 * The permission modes of a session, as the agent port names them. A provider translates them to
 * the modes of its agent. The database stores these values (migration 001).
 */
export const MODES = ['ask', 'accept-edits', 'plan', 'auto', 'approve-all'] as const

export type Mode = (typeof MODES)[number]

/** The name of each mode in the text that the user reads, as the Mode control shows it. */
export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  ask: 'Ask',
  'accept-edits': 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  'approve-all': 'Approve all'
}
