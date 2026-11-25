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
  main: {},
  preload: {
    // A sandboxed preload script must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } }
  },
  renderer: { plugins: [react(), contentSecurityPolicy] }
})
