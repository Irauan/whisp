// Test helper: makes `@swc/core` unresolvable in a Node process, as if it were not installed.
// Use it as `NODE_OPTIONS=--import=<file URL of this file>`.
// dependency-cruiser reads the swc version with `require` and loads swc with `import()`,
// so the helper blocks both.
import Module, { register } from 'node:module'

const isSwc = (request) => request === '@swc/core' || request.startsWith('@swc/core/')

const resolveFilename = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (isSwc(request)) {
    throw Object.assign(new Error(`Cannot find module '${request}' (blocked by the test)`), {
      code: 'MODULE_NOT_FOUND'
    })
  }
  return resolveFilename.call(this, request, ...rest)
}

const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === '@swc/core' || specifier.startsWith('@swc/core/')) {
    throw new Error('Cannot find package @swc/core (blocked by the test)')
  }
  return next(specifier, context)
}
`

register(`data:text/javascript,${encodeURIComponent(hooks)}`)
