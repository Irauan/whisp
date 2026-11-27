import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/** Makes a profile the current one. Aether saves the choice for the next start. */
export const switchProfile = defineContract(
  'profiles.switch',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-profile'],
  {
    valid: [{ id: 'w1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 'w1', extra: true }]
  }
)

export type SwitchProfileError = (typeof switchProfile.errors)[number]
