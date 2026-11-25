export const TRIGGERS = ['@', '#', '&'] as const

export type Trigger = (typeof TRIGGERS)[number]

export interface Mention {
  trigger: Trigger
  query: string
  /** The position of the trigger in the text. */
  start: number
}

/** Finds the mention that ends at the caret. A mention starts the text or follows a space. */
export function findMention(text: string, caret: number): Mention | null {
  const match = /(?:^|\s)([@#&])(\S*)$/.exec(text.slice(0, caret))
  if (!match) return null
  const [, trigger, query = ''] = match
  return { trigger: trigger as Trigger, query, start: caret - query.length - 1 }
}

export interface Edit {
  text: string
  caret: number
}

export function removeMention(text: string, caret: number, mention: Mention): Edit {
  return { text: text.slice(0, mention.start) + text.slice(caret), caret: mention.start }
}

export function insertTrigger(text: string, caret: number, trigger: Trigger): Edit {
  const before = text.slice(0, caret)
  const inserted = before === '' || /\s$/.test(before) ? trigger : ` ${trigger}`
  return { text: before + inserted + text.slice(caret), caret: caret + inserted.length }
}
