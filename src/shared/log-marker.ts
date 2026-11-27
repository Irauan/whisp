/**
 * The line that starts the last log lines of an agent in the text of an error notice. The provider
 * writes it between the message and the log lines, and the session window splits the text at it, so
 * that the log lines go in the fold-out "Show log". Both sides use this one value.
 */
export const LOG_MARKER = 'Last log lines:'

/** The text of an error with the last log lines after it, with the marker as the known boundary. */
export function withLog(message: string, log: string): string {
  return log === '' ? message : `${message}\n${LOG_MARKER}\n${log}`
}

/** The message and the log lines of a text that `withLog` made. A text without the marker has no log. */
export function splitLog(text: string): { message: string; log: string | null } {
  const boundary = `\n${LOG_MARKER}\n`
  const at = text.lastIndexOf(boundary)
  if (at < 0) return { message: text, log: null }
  const log = text.slice(at + boundary.length).trim()
  return { message: text.slice(0, at), log: log === '' ? null : log }
}
