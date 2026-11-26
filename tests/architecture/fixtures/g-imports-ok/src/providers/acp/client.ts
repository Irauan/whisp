// Fixture of valid imports in the target layout: a provider implements a port.
import type { Clock } from '../../building-blocks/clock.port'

export const clock: Clock = { now: () => Date.now() }
