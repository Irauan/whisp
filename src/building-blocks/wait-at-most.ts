/**
 * Waits for a promise, but never longer than the limit. It resolves `done` when the promise settles
 * first, and `timeout` when the limit passes first. It never rejects, so the caller handles a failure
 * of the work on the promise itself. The quit of the app uses it: a hang of one part must not keep
 * Aether open for ever.
 */
export async function waitAtMost(work: Promise<unknown>, limitMs: number): Promise<'done' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), limitMs)
  })
  try {
    return await Promise.race([work.then(() => 'done' as const, () => 'done' as const), limit])
  } finally {
    clearTimeout(timer)
  }
}
