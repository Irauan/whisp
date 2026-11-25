import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'"

// The dev server needs inline scripts for hot reload, so only the build gets the policy.
const contentSecurityPolicy: Plugin = {
  name: 'aether-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend'
    }
  ]
}

export default defineConfig({
  main: {
    // The ACP library is an ES module only, and the main process is CommonJS,
    // so it goes into the bundle. The Claude Code adapter stays outside: it
    // runs as its own program.
    build: { externalizeDeps: { exclude: ['@agentclientprotocol/sdk'] } }
  },
  preload: {
    // A sandboxed preload script must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [react(), contentSecurityPolicy] }
})
