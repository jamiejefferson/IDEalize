// Bundles the idealize-freellmapi fork's server into a single ESM file at
// vendor/freellmapi/server.mjs — the file the packaged app ships in its
// resources and the freetokens plugin spawns as the embedded engine.
//
// Mirrors upstream FreeLLMAPI's own desktop bundling (desktop/scripts/
// bundle-server.mjs): everything inlined, better-sqlite3 left external.
// The bundle has no node_modules, so the fork's driver selection falls
// back to the built-in node:sqlite at runtime — no native modules ship.
//
// Run after changing the fork:  node scripts/vendor-freetokens-server.mjs
// Then commit the refreshed vendor/freellmapi/server.mjs.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forkDir = process.env.IDEALIZE_FREELLMAPI_DIR
  ?? resolve(repoRoot, '..', 'idealize-freellmapi')
const entry = join(forkDir, 'server', 'src', 'index.ts')
const outfile = join(repoRoot, 'vendor', 'freellmapi', 'server.mjs')

if (!existsSync(entry)) {
  console.error(`No fork checkout at ${forkDir} (set IDEALIZE_FREELLMAPI_DIR to override).`)
  process.exit(1)
}

const forkCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: forkDir,
  encoding: 'utf8',
}).trim()

mkdirSync(dirname(outfile), { recursive: true })
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  external: ['better-sqlite3'],
  // Some inlined CJS deps (express internals) reference `require` at
  // runtime; give the ESM bundle a working one.
  banner: {
    js: `// idealize-freellmapi ${forkCommit} — built by scripts/vendor-freetokens-server.mjs; do not edit.\n`
      + "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
console.log(`Bundled idealize-freellmapi ${forkCommit} -> ${outfile}`)
