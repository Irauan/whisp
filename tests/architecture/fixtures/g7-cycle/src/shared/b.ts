// Fixture for G7: b imports a, and a imports b.
import { a } from './a'

export const b = (): string => `b${a}`
