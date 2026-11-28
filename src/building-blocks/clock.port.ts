/** The boundary to the time. Domain and handlers get the time as a value, so a test can fix it. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
