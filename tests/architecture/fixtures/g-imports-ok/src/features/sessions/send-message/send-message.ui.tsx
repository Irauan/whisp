// Fixture of valid imports in the target layout: renderer code imports its contract.
import { useState } from 'react'
import type { Result } from '../../../building-blocks/result'
import { sendMessage } from './send-message.contract'

export function SendMessage() {
  const [last, setLast] = useState<Result<string> | undefined>()
  return <button onClick={() => setLast({ ok: true, value: sendMessage.name })}>{last?.ok}</button>
}
