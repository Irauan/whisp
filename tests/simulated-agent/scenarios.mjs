// The scenarios of the simulated agent.
//
// A scenario is plain data: two lists of steps. The agent runs `initialize` when a client
// sends `initialize`, and `prompt` when a client sends `session/prompt`.
//
//   { do: 'gate', name }                          wait until the test opens the gate `name`
//   { do: 'say', text }                           stream a chunk of the reply
//   { do: 'tool', title, kind, allowed, refused } show a tool call, ask permission, then reply
//   { do: 'update', update }                      send one `session/update` with this update as it is,
//                                                 for example a tool call without a permission request
//   { do: 'log', text }                           write a line to the log of the agent (stderr)
//   { do: 'fail', code, message }                 answer the request with a JSON-RPC error
//   { do: 'exit', code }                          end the agent process
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

  // Takes the steps from the options. Use it for a scenario that no test shares.
  steps: ({ initialize = [], prompt = [] } = {}) => ({ initialize, prompt })
}

/** Returns `{ initialize, prompt }` for a scenario name and its options. */
export function resolveScenario(name, options = {}) {
  const build = Object.hasOwn(scenarios, name) ? scenarios[name] : undefined
  if (!build) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(', ')}.`)
  return build(options)
}
