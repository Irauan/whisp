/** An expected failure: a code that a caller can switch on, and a text for a person. */
export interface AppError<Code extends string = string> {
  code: Code
  message: string
}

/** The answer of a slice. An expected failure returns `ok: false`. A thrown error is a defect. */
export type Result<Value, Code extends string = string> =
  | { ok: true; value: Value }
  | { ok: false; error: AppError<Code> }

export const ok = <Value>(value: Value): Result<Value, never> => ({ ok: true, value })

export const err = <Code extends string>(code: Code, message: string): Result<never, Code> => ({
  ok: false,
  error: { code, message }
})
