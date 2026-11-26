// Fixture of valid imports in the target layout: the result type.
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
