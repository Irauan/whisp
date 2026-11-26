import { randomUUID } from 'node:crypto'

/** Makes the IDs of new records. A test passes its own, so that the IDs are known. */
export interface Ids {
  next(): string
}

export const randomIds: Ids = { next: () => randomUUID() }
