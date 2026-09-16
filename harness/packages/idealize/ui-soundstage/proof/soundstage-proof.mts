/**
 * Proof run (not a vitest spec): boot the REAL Sound Stage composition —
 * storage, sessions, workspaces, the webserver, `@idealize/artefacts`, the
 * generation seam with `@idealize/gen-fixture`, `@idealize/gen-tools`' three
 * tools and `@idealize/ui-soundstage` itself — run the REAL `generate_audio`
 * tool through the REAL tool registry, then render the shipped view against
 * the session logs those runs left, headlessly at 1280x840 in both themes.
 *
 * Four sessions in one project, one per proof:
 *   stage      three finished sounds, one of them a real one-second tone
 *   generating one still in flight
 *   error      one the provider refused
 *   empty      a chat that has generated nothing
 *
 * Two backends serve the runs: `@idealize/gen-fixture` itself (its silent
 * 44-byte WAV proves the shipped keyless adapter reaches the stage) and a
 * proof-only backend on the same `ctx.generation` seam that synthesises a
 * 440 Hz tone, because the fixture payload decodes to a zero duration and the
 * playback proof asserts a real one, plus the never-settling and
 * always-refusing models the in-flight and failure proofs need.
 *
 * Rows come from `@idealize/ui-gallery`'s Definition over the session log,
 * which is the app's own per-chat source; nothing here lists the project.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-soundstage/proof/soundstage-proof.mts
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// Resolved from pnpm's virtual store: esbuild arrives transitively (vite), so
// the proof reaches it the way it reaches the web e2e browser below.
import { build } from '../../../../node_modules/.pnpm/node_modules/esbuild/lib/main.js'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import ArtefactStore from '@idealize/artefacts'
import GenerationRuntime, { GENERATION_SCHEMA_VERSION, GenerationError } from '@idealize/generate'
import * as GenFixture from '@idealize/gen-fixture'
import * as GenTools from '@idealize/gen-tools/tools'
// The brand token sheet, read from the skin package's source (not a workspace
// dependency of this package: the proof borrows it purely to paint the page).
import { SKIN_CSS } from '../../skin/src/skin-css.ts'
import * as Soundstage from '../src/index.ts'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const FIXTURE_BACKEND = 'fixture'
const FIXTURE_SOUND = 'fixture-sound'
const PROOF_BACKEND = 'proof-sounds'
const PROOF_TONE = 'proof-tone'
const PROOF_SLOW = 'proof-slow'
const PROOF_REFUSING = 'proof-refusing'

/** A 16-bit mono PCM WAV of one 440 Hz tone, so the player has a real duration to report. */
function toneWav(seconds: number, hz: number, rate = 8000): Buffer {
  const frames = Math.round(seconds * rate)
  const data = Buffer.alloc(frames * 2)
  for (let index = 0; index < frames; index += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * index) / rate) * 12000), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.byteLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.byteLength, 40)
  return Buffer.concat([header, data])
}

// ── The proof-only Service Provider on ctx.generation ───────────────────────
/** The preset -> model choice the tools read; the run flips it per call. */
const stored: Record<string, { provider: string; model: string }> = {
  sound: { provider: PROOF_BACKEND, model: PROOF_TONE },
}

const proofBackendPlugin = {
  name: 'proof-soundstage-backend',
  inject: ['generation'],
  apply(ctx: Context) {
    const models = [PROOF_TONE, PROOF_SLOW, PROOF_REFUSING].map(id => ({
      id,
      name: id,
      artefact: 'audio' as const,
      inputModalities: ['text' as const],
      outputMediaTypes: ['audio/wav'],
    }))
    ctx.effect(() => ctx.generation.register({
      id: PROOF_BACKEND,
      describe: () => [{
        operation: 'generate' as const,
        artefact: 'audio' as const,
        inputModalities: ['text' as const],
        outputMediaTypes: ['audio/wav'],
        availability: 'available' as const,
        schemaVersion: GENERATION_SCHEMA_VERSION,
      }],
      models: () => models,
      generate: async (request) => {
        if (request.model.model === PROOF_REFUSING) {
          throw new GenerationError(
            'openrouter: 402 payment required - the sound account has no remaining credit, '
            + 'add credit or choose another Sound model',
            'PROVIDER_ERROR',
          )
        }
        if (request.model.model === PROOF_SLOW) {
          // Never settles: the call stays in flight for the generating proof.
          return await new Promise<never>(() => {})
        }
        return {
          schemaVersion: GENERATION_SCHEMA_VERSION,
          backend: PROOF_BACKEND,
          model: PROOF_TONE,
          artefact: 'audio' as const,
          outputs: [{ mediaType: 'audio/wav', data: toneWav(1, 440).toString('base64') }],
          timestamp: Date.now(),
        }
      },
    } as never), 'proof-soundstage: backend')

    // The tools read the preset -> model choice out of the settings section;
    // the real section needs the settings stack this keyless run does not
    // compose, so the proof provides the one face they read.
    ctx.provide('settings' as never, {
      get: () => ({ models: stored }),
    } as never)
  },
}

// ── Boot the composition ───────────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-soundstage-proof-'))
const projectDir = join(root, 'project')
await mkdir(projectDir, { recursive: true })

const configPath = join(root, 'cordis.yml')
await writeFile(configPath, [
  "- name: '@deepseek-ai/dsh-storage'",
  "- name: '@deepseek-ai/dsh-storage-json'",
  '  config:',
  `    root: ${JSON.stringify(join(root, 'storage'))}`,
  "- name: '@deepseek-ai/dsh-storage-domain'",
  '  config:',
  '    backend: json',
  "- name: '@deepseek-ai/dsh-session'",
  "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
  '  config:',
  `    root: ${JSON.stringify(join(root, 'sessions'))}`,
  "- name: '@deepseek-ai/dsh-workspace'",
  "- name: '@deepseek-ai/dsh-system-prompt'",
  "- name: '@deepseek-ai/dsh-tools'",
  "- name: '@deepseek-ai/dsh-host-webserver'",
  '  config:',
  "    host: '127.0.0.1'",
  '    port: 0',
  "- name: '@idealize/artefacts'",
  "- name: '@idealize/generate'",
  "- name: '@idealize/gen-fixture'",
  '  config:',
  `    backendId: ${FIXTURE_BACKEND}`,
  '    models:',
  `      - id: ${FIXTURE_SOUND}`,
  '        artefact: audio',
  "- name: 'proof-soundstage-backend'",
  "- name: '@idealize/gen-tools/tools'",
  "- name: '@idealize/ui-soundstage'",
  '',
].join('\n'))

const context = new Context()
context.baseUrl = pathToFileURL(root).href + '/'
await context.plugin(Loader)
context.loader.builtins.include = Include
const modules = new Map<string, unknown>([
  ['@deepseek-ai/dsh-storage', Storage],
  ['@deepseek-ai/dsh-storage-json', StorageJson],
  ['@deepseek-ai/dsh-storage-domain', StorageDomain],
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
  ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRegistry],
  ['@deepseek-ai/dsh-host-webserver', HttpServer],
  ['@idealize/artefacts', ArtefactStore],
  ['@idealize/generate', GenerationRuntime],
  ['@idealize/gen-fixture', GenFixture],
  ['proof-soundstage-backend', proofBackendPlugin],
  ['@idealize/gen-tools/tools', GenTools],
  ['@idealize/ui-soundstage', Soundstage],
])
context.loader.internal = {
  version: 'v2',
  async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  },
} as unknown as NonNullable<typeof context.loader.internal>
await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
await context.loader.await()
const port: number = context.webServer.port

await context.workspaceRegistry.create(projectDir)

// ── Run the real tool, wrapped in the envelopes the agent loop writes ───────
let callSeq = 0

/**
 * Dispatch one `generate_audio` call through the real tool registry, appending
 * the `tool/call` and `tool/result` envelopes the agent loop writes around it.
 */
async function generate(
  session: { append: (type: string, data: unknown, options?: unknown) => { seq: number } },
  args: { prompt: string; duration_s?: number },
  model: { provider: string; model: string },
): Promise<void> {
  callSeq += 1
  stored.sound = { provider: model.provider, model: model.model }
  const callId = CallId(`proof-call-${String(callSeq)}`)
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'generate_audio', arguments: JSON.stringify(args),
  })
  const result = await context.tools.execute({
    callId,
    name: 'generate_audio',
    arguments: args,
    agent: { session } as never,
    signal: new AbortController().signal,
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...result.error?.info ? { error: result.error.info } : {},
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
}

/** Open one chat in the project and state what it asked for. */
function chat(title: string, text: string) {
  const session = context.sessions.create(undefined, { meta: { cwd: projectDir, title } })
  session.append('user/message', {
    turn: 1,
    message: {
      id: `proof-user-${title}`,
      role: 'user',
      source: { kind: 'human' },
      content: [{ type: 'text', text }],
    },
  }, { surfaceOp: 'append' })
  return session
}

const stage = chat('stage', 'Three sounds for the harbour scene, please.')
await generate(stage as never, { prompt: 'a distant foghorn over harbour water', duration_s: 1 }, { provider: PROOF_BACKEND, model: PROOF_TONE })
await generate(stage as never, { prompt: 'a room tone with a ticking clock' }, { provider: FIXTURE_BACKEND, model: FIXTURE_SOUND })
await generate(stage as never, { prompt: 'rope creaking against a bollard' }, { provider: FIXTURE_BACKEND, model: FIXTURE_SOUND })

const failing = chat('error', 'A brass swell over a field recording.')
await generate(failing as never, { prompt: 'a brass swell over a field recording' }, { provider: PROOF_BACKEND, model: PROOF_REFUSING })

const empty = chat('empty', 'Open the sound stage.')

// Last, and the only un-awaited call: the never-settling generation reads the
// preset choice after its dispatch returns, so nothing may reroute it behind.
const generating = chat('generating', 'A slow tape loop of a harmonium.')
void generate(generating as never, { prompt: 'a slow tape loop of a harmonium' }, { provider: PROOF_BACKEND, model: PROOF_SLOW })
await new Promise(resolve => setTimeout(resolve, 250))

// ── The proof page: real component, real routes, real theme tokens ─────────
const bundleDir = join(root, 'bundle')
await build({
  entryPoints: [join(here, 'entry.tsx')],
  outfile: join(bundleDir, 'proof.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})
const bundleJs = await readFile(join(bundleDir, 'proof.js'), 'utf8')
const bundleCss = await readFile(join(bundleDir, 'proof.css'), 'utf8')
const themeDir = join(repoRoot, 'packages/client/ui-theme/src/styles')
const baseCss = await readFile(join(themeDir, 'base.css'), 'utf8')
const platformCss = await readFile(join(themeDir, 'design-platform.css'), 'utf8')

const page$ = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sound Stage proof</title>
<style>${baseCss}\n${platformCss}\n${SKIN_CSS}\n${bundleCss}
html, body { margin: 0; height: 100%; }
body { font-family: var(--dsw-font-family); background: var(--dsw-alias-bg-base); }
#stage { height: 100vh; }
</style></head>
<body><div id="stage"></div><script type="module">${bundleJs}</script></body></html>`

context.effect(() => context.webServer.register({
  kind: 'exact',
  path: '/proof',
  handler: (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page$)
  },
}), 'soundstage-proof: page')

const sessionsById = new Map<string, { events: readonly unknown[] }>()
for (const session of [stage, generating, failing, empty]) {
  sessionsById.set(String(session.header.id), session as never)
}
context.effect(() => context.webServer.register({
  kind: 'exact',
  path: '/proof/events',
  handler: (req, res) => {
    const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('session') ?? ''
    const session = sessionsById.get(id)
    if (session === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{}')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(session.events))
  },
}), 'soundstage-proof: events')

// ── Capture ────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const browserContext = await browser.newContext({
  viewport: { width: 1280, height: 840 },
  deviceScaleFactor: 2,
  locale: 'en-GB',
})
const page = await browserContext.newPage()
const errors: string[] = []
page.on('pageerror', (error: unknown) => errors.push(String(error)))

/** Load one session's Sound Stage in one theme. */
async function open(session: { header: { id: unknown } }, theme: 'light' | 'dark'): Promise<void> {
  const url = `http://127.0.0.1:${String(port)}/proof`
    + `?session=${encodeURIComponent(String(session.header.id))}&theme=${theme}`
  await page.goto(url, { waitUntil: 'load' })
  await page.locator('[data-soundstage]').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
}

/** Shoot one scene in one theme. */
async function shoot(file: string, theme: 'light' | 'dark'): Promise<void> {
  await page.screenshot({ path: join(out, `${file}-${theme}.png`) })
  console.log(`  -> ${file}-${theme}.png`)
}

for (const theme of ['light', 'dark'] as const) {
  // 1. The chat's own sounds, each with a player and a file path.
  await open(stage, theme)
  const rows = await page.locator('[data-soundstage-sound]').count()
  console.log(`stage/${theme}: ${String(rows)} sound rows`)
  if (rows !== 3) throw new Error(`expected three sound rows, got ${String(rows)}`)
  const paths = await page.locator('[data-soundstage-sound]').evaluateAll(nodes =>
    nodes.map(node => node.textContent ?? ''))
  if (!paths.every(text => text.includes('Sounds/'))) {
    throw new Error(`a row does not name its file under Sounds/: ${JSON.stringify(paths)}`)
  }
  await shoot('soundstage-list', theme)

  // 2. Playback: the tone row's element must actually decode its source off
  // the artefact raw route — past HAVE_METADATA, a real duration, advancing.
  // The tone row by its own prompt: the two fixture sounds are silent WAVs
  // whose decoded duration is zero, so only this one can prove playback.
  const toneRow = page.locator('[data-soundstage-sound]').filter({ hasText: 'foghorn' })
  const loaded = await toneRow.locator('audio').evaluate(async (element) => {
    const audio = element as HTMLAudioElement
    if (audio.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        audio.addEventListener('loadedmetadata', () => { resolve() }, { once: true })
        audio.addEventListener('error', () => { reject(new Error('the audio element failed to load its source')) }, { once: true })
      })
    }
    await audio.play()
    await new Promise(resolve => setTimeout(resolve, 350))
    return { src: audio.currentSrc, readyState: audio.readyState, duration: audio.duration, currentTime: audio.currentTime }
  })
  console.log(`playback/${theme}:`, JSON.stringify(loaded))
  if (loaded.readyState < 1) throw new Error('the audio element never reached HAVE_METADATA')
  if (!(loaded.duration > 0.9 && loaded.duration < 1.2)) {
    throw new Error(`expected a one-second tone, got duration ${String(loaded.duration)}`)
  }
  if (!loaded.src.includes('/idealize/artefacts/raw?id=')) {
    throw new Error(`the player is not streaming from the artefact raw route: ${loaded.src}`)
  }
  if (loaded.currentTime <= 0) throw new Error('playback never advanced')
  await shoot('soundstage-playing', theme)

  // 3. Archive one sound through the REAL route: the file moves under
  // Sounds/Archive, the store appends `artefact/disposition`, the row drops
  // into the archived fold; Keep brings both back.
  await page.locator('[data-soundstage-verdict="archived"]').first().click()
  await page.locator('[data-soundstage-archived-fold="1"]').waitFor({ timeout: 5_000 })
  const archivedOnDisk = await readdir(join(projectDir, 'Sounds', 'Archive'))
  console.log(`archived/${theme}: on disk ${JSON.stringify(archivedOnDisk)}`)
  if (archivedOnDisk.length !== 1) throw new Error('the archived sound did not move under Sounds/Archive')
  const shownAfter = await page.locator('ul [data-soundstage-sound]').count()
  if (shownAfter !== 3) throw new Error(`expected two listed and one folded row, got ${String(shownAfter)}`)
  await page.locator('[data-soundstage-archived-fold]').click()
  await shoot('soundstage-archived', theme)
  await page.locator('[data-soundstage-verdict="kept"]').first().click()
  await page.locator('[data-soundstage-archived-fold]').waitFor({ state: 'detached', timeout: 5_000 })
  if ((await readdir(join(projectDir, 'Sounds', 'Archive'))).length !== 0) {
    throw new Error('Keep did not move the file back out of Sounds/Archive')
  }

  // 4. A generation in progress.
  await open(generating, theme)
  if (await page.locator('[data-soundstage-generating]').count() !== 1) {
    throw new Error('the in-flight generation row is missing')
  }
  await shoot('soundstage-generating', theme)

  // 5. The error row and its Retry.
  await open(failing, theme)
  const cause = await page.locator('[data-soundstage-error] [role="alert"]').first().textContent()
  const retry = await page.getByRole('button', { name: 'Retry' }).count()
  console.log(`error/${theme}: retry=${String(retry)} cause=${JSON.stringify(cause)}`)
  if (retry !== 1) throw new Error('the error row offers no Retry')
  if (cause === null || !cause.includes('402 payment required')) {
    throw new Error(`the provider cause is missing from the row: ${String(cause)}`)
  }
  await shoot('soundstage-error', theme)

  // 6. The empty state says the chat is empty, not the project.
  await open(empty, theme)
  const emptyText = await page.locator('[data-soundstage-empty]').textContent()
  console.log(`empty/${theme}: ${JSON.stringify(emptyText)}`)
  if (emptyText === null || !emptyText.includes('No sounds in this chat yet.')) {
    throw new Error(`the empty state does not say the chat is empty: ${String(emptyText)}`)
  }
  await shoot('soundstage-empty', theme)
}

await browser.close()
await context.fiber.dispose()
await rm(root, { recursive: true, force: true })
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote Sound Stage proofs to ${out}`)
