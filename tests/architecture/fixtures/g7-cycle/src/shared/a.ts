// Fixture for G7: a imports b, and b imports a.
import { b } from './b'

export const a = (): string => `a${b}`
