// Fixture for the swc check: TypeScript syntax that only the swc parser reads.
import type { Shape } from './shape'

export enum Kind {
  Round,
  Square
}

export const describe = (shape: Shape): Kind => (shape.sides > 2 ? Kind.Square : Kind.Round)
