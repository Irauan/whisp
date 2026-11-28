import type { SessionEvent } from './session-view'

// The rules of the session rows of the sidebar (story S11). They are pure, so a unit test runs them
// in Node: no React, no window.

type Status = 'idle' | 'starting' | 'working'

/** The state of a session row. It is the accessible description of the row, and it picks the icon. */
export type SessionState = 'Needs your answer' | 'Working' | 'New answer'

/**
 * The state of a session row. The first matching state wins:
 * 1. Needs your answer: a card waits for the user, or the trust or directory question of the session waits.
 * 2. Working: the status is `starting` or `working`.
 * 3. New answer: the session has the unread mark.
 * Otherwise the state is normal, and the result is null.
 */
export function sessionState(input: { status: Status; openCardIds: readonly string[]; unread: boolean; asking: boolean }): SessionState | null {
  if (input.openCardIds.length > 0 || input.asking) return 'Needs your answer'
  if (input.status !== 'idle') return 'Working'
  return input.unread ? 'New answer' : null
}

/** The strongest state of a group of sessions, for a collapsed group: the hand, then the blue icon. Working does not show. */
export function groupState(states: readonly (SessionState | null)[]): 'Needs your answer' | 'New answer' | null {
  if (states.includes('Needs your answer')) return 'Needs your answer'
  return states.includes('New answer') ? 'New answer' : null
}

/** The fields of a session that the sidebar map keeps up to date from the events. */
export interface SidebarItem {
  id: string
  status: Status
  openCardIds: readonly string[]
  unread: boolean
  /** The revision of the last event that the item holds. */
  revision: number
}

/**
 * Applies one event of `sessions.changed` to the sidebar map, in the order of the revision:
 * - An event at or below the revision of its item changes nothing.
 * - The next revision applies. Each change moves the revision on. Only `status`, `card-opened`,
 *   `card-closed` and `unread` change a field. The map keeps the open card IDs, not a count.
 * - A later revision is a gap. The result is null: the caller loads the list again.
 * An event of a session that the map does not hold changes nothing: the next list gives its item.
 */
export function applySidebarEvent<Item extends SidebarItem>(items: ReadonlyMap<string, Item>, event: SessionEvent): ReadonlyMap<string, Item> | null {
  const item = items.get(event.sessionId)
  if (!item || event.revision <= item.revision) return items
  if (event.revision !== item.revision + 1) return null
  const next = new Map(items)
  next.set(event.sessionId, { ...changed(item, event.change), revision: event.revision })
  return next
}

/**
 * Replays the latest events on a new list, oldest first. An event that the list already holds changes nothing.
 * A gap stops the replay: `gap` is true, and the caller loads the list again, as the live path does. The
 * items are those that the events before the gap give.
 */
export function replaySidebarEvents<Item extends SidebarItem>(
  items: ReadonlyMap<string, Item>,
  events: readonly SessionEvent[]
): { items: ReadonlyMap<string, Item>; gap: boolean } {
  let current = items
  for (const event of events) {
    const next = applySidebarEvent(current, event)
    if (next === null) return { items: current, gap: true }
    current = next
  }
  return { items: current, gap: false }
}

function changed<Item extends SidebarItem>(item: Item, change: SessionEvent['change']): Item {
  switch (change.type) {
    case 'status':
      return { ...item, status: change.status }
    case 'card-opened': {
      const id = change.card.kind === 'permission' ? change.card.permission.id : change.card.elicitation.id
      return item.openCardIds.includes(id) ? item : { ...item, openCardIds: [...item.openCardIds, id] }
    }
    case 'card-closed':
      return { ...item, openCardIds: item.openCardIds.filter((id) => id !== change.id) }
    case 'unread':
      return { ...item, unread: change.unread }
    default:
      return item
  }
}
