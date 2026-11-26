import { z } from 'zod'
import type { Result } from './result'

/** The errors that the main process itself returns, for any contract. */
export const COMMON_ERRORS = ['unknown-contract', 'invalid-input', 'forbidden', 'defect'] as const
export type CommonError = (typeof COMMON_ERRORS)[number]

export interface Examples {
  /** Inputs that the input schema accepts. */
  valid: readonly unknown[]
  /** Inputs that the input schema rejects. */
  invalid: readonly unknown[]
}

export interface Contract<
  Input extends z.ZodType = z.ZodType,
  Value extends z.ZodType = z.ZodType,
  Code extends string = string
> {
  /** The name for `invoke`: `<feature>.<action>`, in lower case. */
  readonly name: string
  readonly input: Input
  /** The schema of the value of a success. */
  readonly result: Value
  /** The error codes of the slice. */
  readonly errors: readonly Code[]
  readonly examples: Examples
  /** The schema of the whole answer: a success, or an error with a code of the slice or a common code. */
  readonly output: z.ZodType<Result<z.output<Value>, Code | CommonError>>
}

const NAME = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/

export function defineContract<Input extends z.ZodType, Value extends z.ZodType, const Code extends string>(
  name: string,
  input: Input,
  result: Value,
  errors: readonly Code[],
  examples: Examples
): Contract<Input, Value, Code> {
  if (!NAME.test(name)) throw new Error(`The contract name "${name}" must be <feature>.<action>, in lower case.`)
  const codes = new Set<string>([...errors, ...COMMON_ERRORS])
  const output = z.union([
    z.object({ ok: z.literal(true), value: result }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.string().refine((code) => codes.has(code)), message: z.string() })
    })
  ])
  // The refine above limits `code` to `Code | CommonError`, which zod cannot show in the type.
  return {
    name,
    input,
    result,
    errors,
    examples,
    output: output as unknown as z.ZodType<Result<z.output<Value>, Code | CommonError>>
  }
}
