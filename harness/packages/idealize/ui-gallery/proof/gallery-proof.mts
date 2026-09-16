/**
 * Proof run (not a vitest spec): boot the REAL Gallery composition — storage,
 * sessions, workspaces, the webserver, `@idealize/artefacts`, the generation
 * seam with `@idealize/gen-fixture`, and `@idealize/gen-tools`' three tools —
 * run the REAL `generate_image` tool through the REAL tool registry, then
 * render the shipped view against the session logs those runs left, headlessly
 * at 1280x840 in both themes.
 *
 * Five sessions in one project, one per proof:
 *   populated  four finished generations
 *   generating the same four plus one still in flight
 *   error      the same four plus one the provider refused
 *   empty      a chat that has generated nothing
 *   media      one image, one video and one sound in the SAME chat, rendered
 *              through both ring entries: Images must show only its image and
 *              Video only its video, which is what makes the two entries one
 *              row source filtered by kind rather than two lists
 *
 * Every artefact is committed by the real tool through `ctx.artefacts`, and
 * every row the page renders is folded from the real session log. Two backends
 * serve the runs: `@idealize/gen-fixture` itself (its 1x1 PNG proves the
 * shipped keyless adapter reaches the grid) and a proof-only backend on the
 * same `ctx.generation` seam that draws a full-size PNG, so the grid shows
 * artwork a reader can judge, plus the never-settling and always-refusing
 * models the in-flight and failure proofs need. The proof backend is a Service
 * Provider like any other; nothing here writes an artefact record by hand.
 *
 * Usage: OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-gallery/proof/gallery-proof.mts
 */
import { deflateSync } from 'node:zlib'
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
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const PROOF_BACKEND = 'proof-images'
const PROOF_STILL = 'proof-still'
const PROOF_SLOW = 'proof-slow'
const PROOF_REFUSING = 'proof-refusing'
const FIXTURE_BACKEND = 'fixture'
const FIXTURE_STILL = 'fixture-still'
const FIXTURE_MOTION = 'fixture-motion'
const FIXTURE_SOUND = 'fixture-sound'

// ── A real PNG encoder, so the grid shows artwork instead of a 1x1 pixel ────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A WxH RGB PNG: a solid ground under a lighter diagonal band, inside a pale border. */
function drawPng(width: number, height: number, [r, g, b]: readonly [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    raw[cursor] = 0
    cursor += 1
    for (let x = 0; x < width; x += 1) {
      const band = (x + y) % 96 < 34 ? 34 : 0
      const edge = x < 4 || y < 4 || x >= width - 4 || y >= height - 4
      raw[cursor] = edge ? 250 : Math.min(255, r + band)
      raw[cursor + 1] = edge ? 250 : Math.min(255, g + band)
      raw[cursor + 2] = edge ? 250 : Math.min(255, b + band)
      cursor += 3
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const COLOURS = [[38, 78, 132], [126, 54, 96], [42, 104, 88], [140, 92, 34], [78, 62, 128]] as const

// ── The proof-only Service Provider on ctx.generation ───────────────────────
/** The preset -> model choice the tools read; the run flips the one it uses per call. */
const stored: Record<string, { provider: string; model: string }> = {
  images: { provider: PROOF_BACKEND, model: PROOF_STILL },
  motion: { provider: FIXTURE_BACKEND, model: FIXTURE_MOTION },
  sound: { provider: FIXTURE_BACKEND, model: FIXTURE_SOUND },
}
let drawn = 0

const proofBackendPlugin = {
  name: 'proof-gallery-backend',
  inject: ['generation'],
  apply(ctx: Context) {
    const models = [PROOF_STILL, PROOF_SLOW, PROOF_REFUSING].map(id => ({
      id,
      name: id,
      artefact: 'image' as const,
      inputModalities: ['text' as const],
      outputMediaTypes: ['image/png'],
    }))
    ctx.effect(() => ctx.generation.register({
      id: PROOF_BACKEND,
      describe: () => [{
        operation: 'generate' as const,
        artefact: 'image' as const,
        inputModalities: ['text' as const],
        outputMediaTypes: ['image/png'],
        availability: 'available' as const,
        schemaVersion: GENERATION_SCHEMA_VERSION,
      }],
      models: () => models,
      generate: async (request) => {
        if (request.model.model === PROOF_REFUSING) {
          throw new GenerationError(
            'openrouter: 402 payment required - the image account has no remaining credit, '
            + 'add credit or choose another Images model',
            'PROVIDER_ERROR',
          )
        }
        if (request.model.model === PROOF_SLOW) {
          // Never settles: the call stays in flight for the pending-tile proof.
          return await new Promise<never>(() => {})
        }
        const colour = COLOURS[drawn % COLOURS.length]!
        drawn += 1
        return {
          schemaVersion: GENERATION_SCHEMA_VERSION,
          backend: PROOF_BACKEND,
          model: PROOF_STILL,
          artefact: 'image' as const,
          outputs: [{ mediaType: 'image/png', data: drawPng(512, 384, colour).toString('base64') }],
          timestamp: Date.now(),
        }
      },
    } as never), 'proof-gallery: backend')

    // The tools read the preset -> model choice out of the settings section;
    // the real section needs the settings stack this keyless run does not
    // compose, so the proof provides the one face they read.
    ctx.provide('settings' as never, {
      get: () => ({ models: stored }),
    } as never)
  },
}

// ── Boot the composition ───────────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-gallery-proof-'))
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
  `      - id: ${FIXTURE_STILL}`,
  '        artefact: image',
  `      - id: ${FIXTURE_MOTION}`,
  '        artefact: video',
  `      - id: ${FIXTURE_SOUND}`,
  '        artefact: audio',
  "- name: 'proof-gallery-backend'",
  "- name: '@idealize/gen-tools/tools'",
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
  ['@idealize/gen-tools/tools', GenTools],
  ['proof-gallery-backend', proofBackendPlugin],
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

const workspace = await context.workspaceRegistry.create(projectDir)

// ── Run the real tool, wrapped in the envelopes the agent loop writes ───────
let callSeq = 0

/** Which tool a media preset's generations go through. */
const TOOL_OF: Record<string, string> = {
  images: 'generate_image',
  motion: 'generate_video',
  sound: 'generate_audio',
}

/**
 * Dispatch one generation call through the real tool registry, appending the
 * `tool/call` and `tool/result` envelopes the agent loop writes around it.
 */
async function generate(
  session: { append: (type: string, data: unknown, options?: unknown) => { seq: number } },
  args: { prompt: string; aspect?: string; duration_s?: number },
  model: { provider: string; model: string },
  preset = 'images',
): Promise<void> {
  callSeq += 1
  stored[preset] = { provider: model.provider, model: model.model }
  const name = TOOL_OF[preset]!
  const callId = CallId(`proof-call-${String(callSeq)}`)
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name, arguments: JSON.stringify(args),
  })
  const result = await context.tools.execute({
    callId,
    name,
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

const PROMPTS = [
  'a small brass fish on a slate table',
  'the same brass fish, lit hard from the left',
  'a brass fish seen from directly above',
  'a brass fish resting on folded linen',
] as const

/** Four finished generations: three drawn, one straight from @idealize/gen-fixture. */
async function fourFinished(session: Parameters<typeof generate>[0]): Promise<void> {
  for (const [index, prompt] of PROMPTS.entries()) {
    await generate(
      session,
      { prompt, aspect: '4:3' },
      index === PROMPTS.length - 1
        ? { provider: FIXTURE_BACKEND, model: FIXTURE_STILL }
        : { provider: PROOF_BACKEND, model: PROOF_STILL },
    )
  }
}

const populated = chat('populated', 'Four studies of a small brass fish, please.')
await fourFinished(populated as never)

const failing = chat('error', 'Four studies, then one in open water.')
await fourFinished(failing as never)
await generate(failing as never, { prompt: 'a brass fish in open water', aspect: '16:9' }, { provider: PROOF_BACKEND, model: PROOF_REFUSING })

const empty = chat('empty', 'Open the gallery.')

// One chat, three kinds. Both ring entries read this one session log, so what
// each shows is decided by its kind and nothing else.
const media = chat('media', 'A still, a clip and a sound of the same brass fish.')
await generate(media as never, { prompt: 'a small brass fish on a slate table', aspect: '4:3' }, { provider: PROOF_BACKEND, model: PROOF_STILL })
await generate(media as never, { prompt: 'the brass fish turning slowly', aspect: '16:9' }, { provider: FIXTURE_BACKEND, model: FIXTURE_MOTION }, 'motion')
await generate(media as never, { prompt: 'water dripping onto brass', duration_s: 5 }, { provider: FIXTURE_BACKEND, model: FIXTURE_SOUND }, 'sound')

// Last, and the only un-awaited call: the never-settling generation reads the
// preset choice after its dispatch returns, so nothing may reroute the choice
// behind it.
const generating = chat('generating', 'Four studies, then one long exposure.')
await fourFinished(generating as never)
void generate(generating as never, { prompt: 'a brass fish, long exposure', aspect: '1:1' }, { provider: PROOF_BACKEND, model: PROOF_SLOW })
// The dispatch has to reach the backend before the page reads the log.
await new Promise(resolve => setTimeout(resolve, 250))

// ── The proof page: real components, real routes, real theme tokens ────────
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

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Gallery proof</title>
<style>${baseCss}\n${platformCss}\n${SKIN_CSS}\n${bundleCss}
html, body { margin: 0; height: 100%; }
body { font-family: var(--dsw-font-family); background: var(--dsw-alias-bg-base); }
#stage { height: 100vh; }
.page { display: flex; flex-direction: column; height: 100%; }
.body { flex: 1; min-height: 0; }
.dock { flex: none; padding: 8px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.draft { margin-top: 6px; padding: 10px 12px; min-height: 20px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
</style></head>
<body><div id="stage"></div><script type="module">${bundleJs}</script></body></html>`

context.effect(() => context.webServer.register({
  kind: 'exact',
  path: '/proof',
  handler: (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
  },
}), 'gallery-proof: page')

const sessionsById = new Map<string, { events: readonly unknown[] }>()
for (const session of [populated, generating, failing, empty, media]) {
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
}), 'gallery-proof: events')

// ── Capture ────────────────────────────────────────────────────────────────
const browser = await chromium.launch()
const browserContext = await browser.newContext({
  viewport: { width: 1280, height: 840 },
  deviceScaleFactor: 2,
  locale: 'en-GB',
})
const capture = await browserContext.newPage()
const errors: string[] = []
capture.on('pageerror', (error: unknown) => errors.push(String(error)))

/** Load one session through one ring entry's kind, in one theme. */
async function open(
  session: { header: { id: unknown } },
  theme: 'light' | 'dark',
  kind: 'image' | 'video' = 'image',
): Promise<void> {
  const url = `http://127.0.0.1:${String(port)}/proof`
    + `?session=${encodeURIComponent(String(session.header.id))}&theme=${theme}&kind=${kind}`
  await capture.goto(url, { waitUntil: 'load' })
  await capture.locator('[data-gallery-root]').waitFor({ timeout: 20_000 })
  await capture.waitForTimeout(400)
}

async function shoot(file: string, theme: 'light' | 'dark'): Promise<void> {
  await capture.screenshot({ path: join(out, `${file}-${theme}.png`) })
  console.log(`  -> ${file}-${theme}.png`)
}

for (const theme of ['light', 'dark'] as const) {
  // 1. The populated grid.
  await open(populated, theme)
  const done = await capture.locator('[data-gallery-tile="done"]').count()
  console.log(`populated/${theme}: ${String(done)} finished tiles`)
  if (done !== 4) throw new Error(`expected four finished tiles, got ${String(done)}`)
  // Every thumbnail must have actually decoded off the artefact raw route.
  const images = await capture.locator('[data-gallery-image]').evaluateAll(nodes =>
    nodes.map((node) => {
      const image = node as HTMLImageElement
      return { src: image.currentSrc, complete: image.complete, width: image.naturalWidth }
    }))
  console.log(`populated/${theme}: images ${JSON.stringify(images)}`)
  if (images.length !== 4) throw new Error(`expected four thumbnails, got ${String(images.length)}`)
  for (const image of images) {
    if (!image.complete || image.width < 1) throw new Error(`a thumbnail never decoded: ${JSON.stringify(image)}`)
    if (!image.src.includes('/idealize/artefacts/raw?id=')) {
      throw new Error(`a thumbnail is not loading from the artefact raw route: ${image.src}`)
    }
  }
  // The composer controls write their tag into the draft.
  await capture.locator('[data-gallery-aspect]').selectOption('16:9')
  await capture.locator('[data-gallery-count]').selectOption('3')
  const draft = await capture.locator('[data-proof-draft]').textContent()
  console.log(`populated/${theme}: draft=${JSON.stringify(draft)}`)
  if (draft !== '[aspect 16:9, 3 images]') throw new Error(`the settings tag is wrong: ${String(draft)}`)
  await shoot('gallery-populated', theme)

  // 1b. Enlarge a tile: the details name the on-disk path under the Images folder.
  await capture.locator('[data-gallery-open]').first().click()
  await capture.locator('[data-gallery-enlarged]').waitFor({ timeout: 5_000 })
  const detailPath = await capture.locator('[data-gallery-detail="path"]').textContent()
  console.log(`populated/${theme}: enlarged path=${JSON.stringify(detailPath)}`)
  if (detailPath === null || !/^Images\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.png$/.test(detailPath)) {
    throw new Error(`the enlarged view does not name the Images-folder path: ${String(detailPath)}`)
  }
  await shoot('gallery-enlarged', theme)
  await capture.keyboard.press('Escape')
  if (await capture.locator('[data-gallery-enlarged]').count() !== 0) throw new Error('Escape did not close the enlarged view')

  // 1c. Archive the first tile through the REAL route: the file moves under
  // Images/Archive, the store appends `artefact/disposition`, the tile drops
  // into the archived fold; Keep brings it back.
  const first = await capture.locator('[data-gallery-open]').first().getAttribute('data-gallery-open')
  await capture.locator(`[data-gallery-tile="done"]:not([data-gallery-archived]) [data-gallery-verdict="archived"]`).first().click({ force: true })
  await capture.locator('[data-gallery-archived-fold="1"]').waitFor({ timeout: 5_000 })
  const archivedOnDisk = (await readdir(join(projectDir, 'Images', 'Archive'))).filter(name => name.startsWith(`${String(detailPath).slice('Images/'.length, -4)}`))
  console.log(`populated/${theme}: archived on disk ${JSON.stringify(archivedOnDisk)}`)
  if (archivedOnDisk.length !== 1) throw new Error('the archived artefact did not move under Images/Archive')
  const shownAfter = await capture.locator('[data-gallery-tile="done"]:not([data-gallery-archived])').count()
  if (shownAfter !== 3) throw new Error(`expected three shown tiles after archiving one, got ${String(shownAfter)}`)
  await capture.locator('[data-gallery-archived-fold]').click()
  await shoot('gallery-archived', theme)
  await capture.locator(`[data-gallery-tile="done"][data-gallery-archived] [data-gallery-verdict="kept"]`).first().click({ force: true })
  await capture.locator('[data-gallery-archived-fold]').waitFor({ state: 'detached', timeout: 5_000 })
  if ((await readdir(join(projectDir, 'Images', 'Archive'))).length !== 0) throw new Error('Keep did not move the file back out of Images/Archive')
  if (first === null || await capture.locator(`[data-gallery-open="${first}"]`).count() !== 1) throw new Error('the kept tile did not return to the grid')

  // 2. A generation in progress.
  await open(generating, theme)
  const running = await capture.locator('[data-gallery-tile="running"]').count()
  console.log(`generating/${theme}: ${String(running)} running tiles`)
  if (running !== 1) throw new Error(`expected one running tile, got ${String(running)}`)
  await shoot('gallery-generating', theme)

  // 3. The error row and its Retry.
  await open(failing, theme)
  const cause = await capture.locator('[data-gallery-cause]').first().textContent()
  const retries = await capture.locator('[data-gallery-retry]').count()
  console.log(`error/${theme}: retry=${String(retries)} cause=${JSON.stringify(cause)}`)
  if (retries !== 1) throw new Error('the failed row offers no Retry')
  if (cause === null || !cause.includes('402 payment required')) {
    throw new Error(`the provider cause is missing from the row: ${String(cause)}`)
  }
  await shoot('gallery-error', theme)

  // 4. The empty state.
  await open(empty, theme)
  if (await capture.locator('[data-gallery-empty]').count() !== 1) {
    throw new Error('the empty state is missing')
  }
  await shoot('gallery-empty', theme)

  // 5. One chat, three generations, two views. Images shows the image and
  // neither the clip nor the sound; Video shows the clip and neither the
  // others; the count control belongs to Images alone, and the Video composer
  // offers the duration the model needs.
  await open(media, theme, 'image')
  const imagesKind = await capture.locator('[data-gallery-root]').getAttribute('data-gallery-kind')
  const imagesShown = await capture.locator('[data-gallery-tile="done"]').count()
  const imagesVideo = await capture.locator('[data-gallery-video]').count()
  const imagesAudio = await capture.locator('[data-gallery-audio]').count()
  console.log(`media/${theme}/images: kind=${String(imagesKind)} tiles=${String(imagesShown)} video=${String(imagesVideo)} audio=${String(imagesAudio)}`)
  if (imagesKind !== 'image') throw new Error(`the Images grid reports kind ${String(imagesKind)}`)
  if (imagesShown !== 1) throw new Error(`Images shows ${String(imagesShown)} tiles; the chat generated one image`)
  if (imagesVideo !== 0 || imagesAudio !== 0) throw new Error('Images is showing another kind\'s artefact')
  if (await capture.locator('[data-gallery-aspect]').count() !== 1 || await capture.locator('[data-gallery-count]').count() !== 1) {
    throw new Error('the Images composer lost its controls')
  }
  await shoot('gallery-media-images', theme)

  await open(media, theme, 'video')
  const videoKind = await capture.locator('[data-gallery-root]').getAttribute('data-gallery-kind')
  const videoShown = await capture.locator('[data-gallery-tile="done"]').count()
  const players = await capture.locator('[data-gallery-video]').evaluateAll(nodes =>
    nodes.map(node => (node as HTMLVideoElement).currentSrc))
  const videoImages = await capture.locator('[data-gallery-image]').count()
  const videoAudio = await capture.locator('[data-gallery-audio]').count()
  console.log(`media/${theme}/video: kind=${String(videoKind)} tiles=${String(videoShown)} players=${JSON.stringify(players)} images=${String(videoImages)} audio=${String(videoAudio)}`)
  if (videoKind !== 'video') throw new Error(`the Video grid reports kind ${String(videoKind)}`)
  if (videoShown !== 1) throw new Error(`Video shows ${String(videoShown)} tiles; the chat generated one clip`)
  if (videoImages !== 0 || videoAudio !== 0) throw new Error('Video is showing another kind\'s artefact')
  if (players.length !== 1 || !players[0]!.includes('/idealize/artefacts/raw?id=')) {
    throw new Error(`the clip is not loading from the artefact raw route: ${JSON.stringify(players)}`)
  }
  // The count states images; a Video chat offers a duration in its place.
  if (await capture.locator('[data-gallery-count]').count() !== 0) {
    throw new Error('the image count followed the composer onto the Video view')
  }
  if (await capture.locator('[data-gen-settings-space="motion"] [data-gen-setting="duration"]').count() !== 1) {
    throw new Error('the Video composer offers no duration')
  }
  await shoot('gallery-media-video', theme)

  // The empty state names the kind, so a Video chat is never told it has no images.
  await open(empty, theme, 'video')
  const emptyVideo = await capture.locator('[data-gallery-empty]').textContent()
  console.log(`empty/${theme}/video: ${JSON.stringify(emptyVideo)}`)
  if (emptyVideo === null || !emptyVideo.includes('No video yet')) {
    throw new Error(`the Video empty state does not name its own kind: ${String(emptyVideo)}`)
  }
}

await browser.close()
await context.fiber.dispose()
await rm(root, { recursive: true, force: true })
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote Gallery proofs to ${out}`)
