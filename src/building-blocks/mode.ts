/**
 * The permission modes of a session, as the agent port names them. A provider translates them to
 * the modes of its agent. The database stores these values (migration 001).
 */
export const MODES = ['ask', 'accept-edits', 'plan', 'auto', 'approve-all'] as const

export type Mode = (typeof MODES)[number]
