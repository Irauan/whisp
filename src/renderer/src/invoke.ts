import type { z } from 'zod'
import type { CommonError, Contract } from '../../building-blocks/contract'
import { err, type Result } from '../../building-blocks/result'

/**
 * Calls the slice of a contract through the bridge and checks the answer against the contract.
 * It never throws. A call that fails, or an answer that does not match, returns the error `defect`.
 */
export async function invokeContract<Input extends z.ZodType, Value extends z.ZodType, Code extends string>(
  contract: Contract<Input, Value, Code>,
  input: z.input<Input>
): Promise<Result<z.output<Value>, Code | CommonError>> {
  try {
    const answer = contract.output.safeParse(await window.aether.invoke(contract.name, input))
    if (answer.success) return answer.data
    return err('defect', 'The main process sent an answer that Aether cannot read.')
  } catch (cause) {
    return err('defect', `Aether could not reach the main process. ${String(cause)}`)
  }
}
