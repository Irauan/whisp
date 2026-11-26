// Fixture: an import type expression hides an import from dependency-cruiser.
export type Handler = import('./other').Other
export type Self = typeof import('./other')
