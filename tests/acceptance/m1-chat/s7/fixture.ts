// The fixture of the S7 tests of milestone m1-chat: A12 and A15, the user decisions of 2026-11-27
// that S7 carries, and the notes of the S3 review for S7.
//
// It reuses the chat fixture of S4 (`../s4/fixture.ts`): the built app in a temporary data folder,
// the simulated agent as Claude Code in `agents.json`, the fake `gh`, and the check of the real data
// folder (`%APPDATA%\aether`). All data is fake. The product has no test hook.
//
// The native pickers. "Files…" and "Folder…" of "Add context" open the file picker of Electron. A
// test cannot click a native dialog, so `stubPickers` replaces `dialog.showOpenDialog` in the main
// process of the running app with a function that returns the paths of the test. It is a change of
// the test to Electron, not a hook of the product.
//
// Trust and directories (story S6). S7 runs in parallel with S6 and does not answer its questions.
// The folder attachment of A15 is the plain folder `repo-b` under the workspace directory: it is
// outside the session folder `repo-a`, but no case of the directory table asks for it. If S6 asks
// for it anyway, S6 adds the answer to the A15 test.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent.
//
// The UI that these tests expect (S7 test contract). The S1 to S4 contracts stay.
// - The Model control of the composer of a new session: the button named exactly "Model" opens the
//   `group` "Model". It has one button for each model, named by its label: "Default", "Fable 5.2",
//   "Opus 5.5", "Sonnet 5.5" and "Haiku 5.5". The label of Opus 5.5 gives the model ID
//   `claude-opus-5-5`, and Haiku 5.5 gives `claude-haiku-5-5`.
// - Model and mode: Aether sends the mode as `session/set_mode` and a model other than "Default" as
//   `session/set_config_option` with `configId` "model", on the agent session, before the first
//   `session/prompt`. "Default" sends no `session/set_config_option` for the model.
// - The Auto fallback: when Aether asked for `auto` and the agent then reports a
//   `current_mode_update` to `acceptEdits`, the transcript shows a notice. Its text names the mode
//   "Auto" and, after it, the mode "Accept edits". The brief leaves the words open. An example:
//   "Auto is not available for this model. Claude uses Accept edits."
// - Attachments: "Add context" opens the `group` "Add context". Its buttons "Files…" and "Folder…"
//   add the paths that the picker returns. The composer lists them in the `list` "Attachments", each
//   with its file or folder name.
// - The first `session/prompt` of a session has one `resource_link` content block for each file and
//   folder attachment. Its `uri` names the path, as a `file:` URI or as the path itself.
// - A folder attachment outside the session folder is in `additionalDirectories` of `session/new`.
// - Refusal at start (S3 review notes): a session with an attachment of an unknown kind, with a
//   `session` attachment, or with a model that Aether does not know, never gets an agent process.
//   Aether refuses it in one of these places: `sessions.create` returns an error, the first
//   `sessions.send-message` returns an error, or the session gets an error notice before any agent
//   process starts. For an unknown model only, the agent can refuse it instead (coordinator
//   decision, 2026-11-27): the session then shows an error notice, and the agent gets no prompt.
// - Claude account (user decision, 2026-11-27): a Claude account is only its config folder. The
//   dialogs "Profile settings" and "Add profile" have the text field "Claude folder" and no field
//   "Claude profile name". The agent environment has no `ANTHROPIC_PROFILE`.
// - Subscription only (user decision, 2026-11-27, decision 0011): Aether never passes the adapter
//   flag `--hide-claude-auth`. The launch of the recipe `claudeCodeRecipe` of
//   `src/providers/claude-code` has no such argument, and an `agents.json` entry gets only its own
//   arguments.
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { AcpMessage } from '../../../simulated-agent/control'
import { startsWith } from '../s3/fixture'
import { expect, main, type ChatApp } from '../s4/fixture'

export * from '../s4/fixture'
export { chooseMode, expectMode, MODE_LABELS, startsWith } from '../s3/fixture'

/** The label of each model of the Model control, and its model ID. */
export const MODEL_IDS = {
  Default: 'default',
  'Fable 5.2': 'claude-fable-5-2',
  'Opus 5.5': 'claude-opus-5-5',
  'Sonnet 5.5': 'claude-sonnet-5-5',
  'Haiku 5.5': 'claude-haiku-5-5'
} as const
export type ModelLabel = keyof typeof MODEL_IDS

/** The text of the notice of the Auto fallback: it names Auto, then Accept edits. */
export const FALLBACK_NOTICE = /\bAuto\b[\s\S]*\bAccept edits\b/

/** Chooses a model with the Model control of the composer of a new session. */
export async function chooseModel(page: Page, label: ModelLabel, check: string): Promise<void> {
  const control = main(page).getByRole('button', { name: 'Model', exact: true })
  await expect(control, `${check}: the composer has no button "Model".`).toBeVisible()
  await control.click()
  const menu = page.getByRole('group', { name: 'Model', exact: true })
  await expect(menu, `${check}: the button "Model" opens no group "Model".`).toBeVisible()
  const option = menu.getByRole('button', { name: startsWith(label) })
  await expect(option, `${check}: the menu "Model" has no model "${label}".`).toBeVisible()
  await option.click()
  await expect(menu).toBeHidden()
  await expect(control, `${check}: the button "Model" does not show "${label}".`).toHaveText(label)
}

/**
 * Replaces the native picker of the running app: a picker for folders returns `folders`, and any
 * other picker returns `files`.
 */
export async function stubPickers(chat: ChatApp, paths: { files: string[]; folders: string[] }): Promise<void> {
  await chat.app.evaluate(({ dialog }, chosen) => {
    const pick = async (...args: unknown[]) => {
      const options = args.at(-1) as { properties?: string[] } | undefined
      const folders = options?.properties?.includes('openDirectory') ?? false
      return { canceled: false, filePaths: folders ? chosen.folders : chosen.files }
    }
    dialog.showOpenDialog = pick as typeof dialog.showOpenDialog
  }, paths)
}

/** Adds the attachments of the stubbed picker with "Files…" or "Folder…" of "Add context". */
export async function addAttachment(page: Page, option: 'Files…' | 'Folder…', name: string, check: string): Promise<void> {
  const button = main(page).getByRole('button', { name: 'Add context', exact: true })
  await expect(button, `${check}: the composer has no button "Add context".`).toBeVisible()
  await button.click()
  const menu = page.getByRole('group', { name: 'Add context', exact: true })
  await expect(menu, `${check}: the button "Add context" opens no group "Add context".`).toBeVisible()
  await menu.getByRole('button', { name: startsWith(option.replace('…', '')) }).click()
  const list = main(page).getByRole('list', { name: 'Attachments' })
  await expect(list.getByText(name, { exact: true }), `${check}: the composer does not list the attachment "${name}".`).toBeVisible()
}

/** Calls a contract through the bridge of the renderer, as the UI does. It returns the `Result` as it comes. */
export async function invoke(page: Page, name: string, input: unknown): Promise<Answer> {
  return page.evaluate(
    // `globalThis` is the window of the renderer. The main zone of the typecheck has no DOM types.
    ([contract, value]) => (globalThis as unknown as { aether: { invoke(n: string, i: unknown): Promise<unknown> } }).aether.invoke(contract, value),
    [name, input] as const
  ) as Promise<Answer>
}

export type Answer = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }

/** The parameters of an ACP request as a record. */
export const paramsOf = (message: AcpMessage | undefined) => (message?.params ?? {}) as Record<string, unknown>

/** The path that a `resource_link` names: a `file:` URI as a path, or the path itself. */
export function pathOfUri(uri: unknown): string | undefined {
  if (typeof uri !== 'string') return undefined
  if (!uri.startsWith('file:')) return uri
  try {
    return fileURLToPath(uri)
  } catch {
    return uri
  }
}

/**
 * The settings that the agent got before the first `session/prompt`: the mode IDs of
 * `session/set_mode`, the values of `session/set_config_option` for the model, and the first prompt.
 * Call it after the first prompt came.
 */
export function settingsBeforeFirstPrompt(chat: ChatApp) {
  const { messages } = chat.control
  const index = messages.findIndex((message) => message.method === 'session/prompt')
  const before = index < 0 ? messages : messages.slice(0, index)
  const setModes = before.filter((message) => message.method === 'session/set_mode')
  const setModels = before.filter((message) => message.method === 'session/set_config_option' && paramsOf(message).configId === 'model')
  return {
    firstPrompt: index < 0 ? undefined : messages[index],
    setModes,
    setModels,
    modes: setModes.map((message) => paramsOf(message).modeId),
    models: setModels.map((message) => paramsOf(message).value),
    /** Each `session/set_config_option` for the model, also after the first prompt. */
    allModels: messages.filter((message) => message.method === 'session/set_config_option' && paramsOf(message).configId === 'model')
  }
}
