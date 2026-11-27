// The scenarios of the simulated agent.
//
// A scenario is plain data: two lists of steps. The agent runs `initialize` when a client
// sends `initialize`, and `prompt` when a client sends `session/prompt`. A scenario can also give
// `noAuto`: the models that cannot use the permission mode `auto` (see the scenario `no-auto`), and
// `exitGate`: a gate that the agent waits at after the client closes its stdin, before it ends
// (see the scenario `slow-exit`).
//
//   { do: 'gate', name }                          wait until the test opens the gate `name`
//   { do: 'say', text }                           stream a chunk of the reply
//   { do: 'tool', title, kind, allowed, refused } show a tool call, ask permission, then reply
//   { do: 'update', update }                      send one `session/update` with this update as it is,
//                                                 for example a tool call without a permission request
//   { do: 'log', text }                           write a line to the log of the agent (stderr)
//   { do: 'fail', code, message }                 answer the request with a JSON-RPC error
//   { do: 'exit', code }                          end the agent process
//   { do: 'child' }                               start a child process that outlives the agent, and
//                                                 report its process ID (see the scenario `child-process`)
//   { do: 'ask' | 'elicit' | 'withdraw' | 'answers' | 'detach', ... }
//                                                 permission requests and form elicitations that do
//                                                 not wait for the answer (see `requests.mjs`)
//
// To add a scenario, add a function to `scenarios`. It takes the options that the test sends
// and returns `{ initialize, prompt }`. Add a step kind in `agent.mjs` only when no step fits.

const gateStep = (name) => ({ do: 'gate', name })
const say = (text) => ({ do: 'say', text })

export const scenarios = {
  // Streams a reply. With `gate`, the reply starts when the test opens that gate.
  text: ({ chunks = ['Hel', 'lo'], gate } = {}) => ({
    initialize: [],
    prompt: [...(gate ? [gateStep(gate)] : []), ...chunks.map(say)]
  }),

  // Shows a tool call and asks permission. The reply tells what the client answered.
  tool: ({ title = 'Edit README.md', kind = 'edit', allowed = 'Edited', refused = 'Skipped', gate } = {}) => ({
    initialize: [],
    prompt: [...(gate ? [gateStep(gate)] : []), { do: 'tool', title, kind, allowed, refused }]
  }),

  // Says that nobody is signed in, in the way an ACP agent does.
  'sign-in-error': ({ message = 'Authentication required' } = {}) => ({
    initialize: [],
    prompt: [{ do: 'fail', code: -32000, message }]
  }),

  // Ends the agent process when it gets a prompt. With `log`, it first writes that line to its log.
  crash: ({ exitCode = 3, log } = {}) => ({
    initialize: [],
    prompt: [...(log === undefined ? [] : [{ do: 'log', text: log }]), { do: 'exit', code: exitCode }]
  }),

  // Waits at a gate before `initialize` returns. The prompt then streams a reply.
  'slow-start': ({ gate = 'initialize', chunks = ['Hel', 'lo'] } = {}) => ({
    initialize: [gateStep(gate)],
    prompt: chunks.map(say)
  }),

  // Streams a reply, as `text` does. The models in `models` cannot use the permission mode `auto`,
  // as with Claude Code: when the mode is `auto` and the model is one of them, the session uses
  // `acceptEdits` and the agent sends a `current_mode_update`. The test chooses the models.
  'no-auto': ({ models, chunks = ['Hel', 'lo'] } = {}) => {
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('The scenario "no-auto" needs `models`: the models that cannot use the mode auto.')
    }
    return { initialize: [], prompt: chunks.map(say), noAuto: [...models] }
  },

  // Added for story S9 of milestone m1-chat (idle release).
  // Starts a child process that outlives the agent, then streams a reply, as `text` does. The child
  // is detached: when the agent ends, the child still runs, until a kill. The agent reports the
  // process ID of the child and its own on the control pipe (`waitForChild` of `control.ts`).
  'child-process': ({ chunks = ['Hel', 'lo'] } = {}) => ({
    initialize: [],
    prompt: [{ do: 'child' }, ...chunks.map(say)]
  }),

  // Streams a reply, as `text` does. When the client closes the stdin of the agent, the agent waits
  // at the gate `gate` before it ends. So a test can act while a process closes.
  'slow-exit': ({ gate = 'exit', chunks = ['Hel', 'lo'] } = {}) => ({
    initialize: [],
    prompt: chunks.map(say),
    exitGate: gate
  }),

  // Added for story S5 of milestone m1-chat. Asks several permissions at the same time, one for
  // each request (see the step `ask` of `requests.mjs`), waits for every answer, then replies.
  // The default: two tool calls, each with "Allow" and "Refuse".
  permissions: ({ requests = [{ id: 'run-tests', title: 'npm test', kind: 'execute' }, { id: 'read-log', title: 'Read last-run.txt', kind: 'read' }], gate, reply = 'Done.' } = {}) => ({
    initialize: [],
    prompt: [...(gate ? [gateStep(gate)] : []), { do: 'ask', requests }, { do: 'answers' }, say(reply)]
  }),

  // Added for story S5 of milestone m1-chat. One shell command with the three options of Claude
  // Code: "Yes" (allow_once), "Yes, and don't ask again for … commands" (allow_always) and "No".
  always: ({ id = 'run-tests', command = 'npm test', prefix = 'npm test', reply = 'Done.' } = {}) => ({
    initialize: [],
    prompt: [
      {
        do: 'ask',
        requests: [
          {
            id,
            title: command,
            kind: 'execute',
            options: [
              { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
              { optionId: 'allow-always', name: `Yes, and don't ask again for ${prefix} commands`, kind: 'allow_always' },
              { optionId: 'reject', name: 'No', kind: 'reject_once' }
            ]
          }
        ]
      },
      { do: 'answers' },
      say(reply)
    ]
  }),

  // Takes the steps from the options. Use it for a scenario that no test shares.
  steps: ({ initialize = [], prompt = [] } = {}) => ({ initialize, prompt })
}

/** Returns `{ initialize, prompt }`, and `noAuto` and `exitGate` when the scenario has them, for a scenario name and its options. */
export function resolveScenario(name, options = {}) {
  const build = Object.hasOwn(scenarios, name) ? scenarios[name] : undefined
  if (!build) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(', ')}.`)
  return build(options)
}
