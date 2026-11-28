// A child process of the simulated agent that outlives its parent (step 'child' of `agent.mjs`).
//
//   node child.mjs \\.\pipe\aether-simulated-agent-1234
//
// It takes the name of the control pipe of the test as its argument, so its command line names
// the test that started it. It never connects to that pipe. It listens on a pipe of its own, which
// keeps it alive with no timer, until something kills it. The test that starts it kills it at its end.
import net from 'node:net'

const pipeName = process.argv[2]
if (!pipeName) {
  console.error('The child of the simulated agent needs the name of the control pipe as its first argument.')
  process.exit(2)
}

net.createServer().listen(`${pipeName}-child-${process.pid}`)
