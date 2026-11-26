// Import rules of docs/architecture.md "Dependencies". Decision 0010 picks the swc parser,
// because the TypeScript parser of dependency-cruiser refuses TypeScript 7.
//
// The paths in the rules are relative to the folder that holds `src`. They cover the current
// layout (src/main, src/preload, src/renderer, src/shared) and the target layout (src/app,
// src/features, src/building-blocks, src/providers). A rule for a folder that does not exist
// matches nothing, so it passes.
//
// The rule names are the names in tests/architecture/known-violations.json.

// Code that runs in the renderer process: renderer folders, `*.ui.ts(x)` files and base UI.
const RENDERER =
  '^src/(?:renderer/|app/renderer/|building-blocks/.*\\.tsx$|features/.*\\.ui\\.tsx?$)'

// Code that runs in the main process: main folders, preload folders and the main zone suffixes.
const MAIN =
  '^src/(?:main/|preload/|app/main/|app/preload/|features/.*\\.(?:controller|handler|store)\\.ts$)'

// What renderer code may import inside `src`: renderer code, contracts and base UI.
// `src/shared` and `src/app/contracts.ts` (the registry) hold the contracts. Base UI is the
// `.tsx` and `.css` files of `building-blocks`, with the two contract helpers `contract.ts`
// and `result.ts`.
const RENDERER_MAY_IMPORT =
  '^src/(?:renderer/|app/renderer/|shared/|app/contracts\\.ts$|' +
  'building-blocks/(?:.*\\.(?:tsx|css)|contract\\.ts|result\\.ts)$|' +
  'features/.*\\.(?:ui\\.tsx?|contract\\.ts)$)'

// A slice is a folder below a feature folder: src/features/<feature>/<slice>/.
// $1 is the feature and $2 is the slice.
const SLICE = '^src/features/([^/]+)/([^/]+)/'

// A domain file is a file without a zone suffix in the root of a feature, for example
// src/features/sessions/session.ts. The shared folder of the current layout is pure too.
const DOMAIN = '^src/(?:shared/|features/[^/]+/[^/.]+\\.ts$)'

// What the domain must not import. dependency-cruiser gives a Node core module as its bare name
// (`fs`, `fs/promises`) and an npm package as its resolved path or, when it is not installed,
// as its name.
const NODE_MODULES = require('node:module').builtinModules.map((name) =>
  name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
)
const IMPURE =
  `^(?:node:.*|${NODE_MODULES.join('|')})$|` +
  '(?:^|/)node_modules/(?:electron|react|react-dom)/|^(?:electron|react|react-dom)(?:/|$)'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No import cycles.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'renderer-imports-no-main',
      comment: 'Renderer code imports no main code and no preload code.',
      severity: 'error',
      from: { path: RENDERER },
      to: { path: MAIN }
    },
    {
      name: 'renderer-imports-only-allowed',
      comment: 'Renderer code imports only contracts, renderer code and base UI.',
      severity: 'error',
      from: { path: RENDERER },
      // `renderer-imports-no-main` reports the main code. This rule reports the rest.
      to: { path: '^src/', pathNot: [RENDERER_MAY_IMPORT, MAIN] }
    },
    {
      name: 'no-slice-to-slice',
      comment: 'A slice never imports another slice.',
      severity: 'error',
      from: { path: SLICE },
      to: { path: '^src/features/[^/]+/[^/]+/', pathNot: '^src/features/$1/$2/' }
    },
    {
      name: 'slice-imports-only-allowed',
      comment:
        'A slice imports only its own files, the root files of its feature, and building-blocks.',
      severity: 'error',
      from: { path: SLICE },
      to: {
        path: '^src/',
        // `no-slice-to-slice` and `slice-imports-no-other-feature-root` report the files under
        // `src/features`. This rule reports the rest.
        pathNot: ['^src/features/', '^src/building-blocks/']
      }
    },
    {
      name: 'slice-imports-no-other-feature-root',
      comment:
        'A slice imports only its own files, the root files of its feature, and building-blocks.',
      severity: 'error',
      from: { path: SLICE },
      to: { path: '^src/features/[^/]+/[^/]+$', pathNot: '^src/features/$1/' }
    },
    {
      name: 'providers-import-no-features',
      comment: 'Providers implement ports from building-blocks and never import features.',
      severity: 'error',
      from: { path: '^src/providers/' },
      to: { path: '^src/features/' }
    },
    {
      name: 'only-app-main-imports-providers',
      comment:
        'Only app/main connects providers to ports. A provider imports its own files. A test file is a composition root and may import a provider.',
      severity: 'error',
      from: { path: '^src/', pathNot: ['^src/providers/', '^src/app/main/', '\\.test\\.tsx?$'] },
      to: { path: '^src/providers/' }
    },
    {
      name: 'domain-imports-no-node-electron-react',
      comment: 'The domain imports nothing from Electron, Node or React.',
      severity: 'error',
      from: { path: DOMAIN },
      to: { path: IMPURE }
    }
  ],
  options: {
    parser: 'swc',
    // Count `import type` as an import: a type import still couples the zones.
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']
    }
  }
}
