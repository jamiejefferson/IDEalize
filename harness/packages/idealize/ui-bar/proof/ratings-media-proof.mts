/**
 * Proof run (not a vitest spec): the media half of ratings and the dislike, on
 * the REAL assembled IDEalize app with scratch data, at 1280×840.
 *
 * `@idealize/gen-fixture` joins the app through a `--patch` overlay and
 * publishes three picture models. An Images chat asks the scripted model for a
 * picture; it calls `generate_image`, which runs on the stored model. Then:
 *
 * 1. **The heart rates the picture's model** for a picture tag.
 * 2. **The dislike offers the other two models** with the price on its button.
 * 3. **The comparison shows their pictures as tiles** above the composer,
 *    since the Images space shows the gallery.
 * 4. **Use this one keeps it**: quiet marks land for the picture tag, and the
 *    chat's next picture is made by the kept model.
 *
 * Isolation and clean-up as in `ratings-proof.mts`.
 *
 * Usage: OUT=.idealize/proof/ratings-media pnpm exec tsx packages/idealize/ui-bar/proof/ratings-media-proof.mts
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import type { Browser, Page } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { startMockLlmServer } from '../../../test-support/llm-mock-server/src/index.ts'
import { assertSettled, openApp } from '../../../../.idealize/proof-settle.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof/ratings'
await mkdir(out, { recursive: true })

// ── Isolation, verified before anything is written ─────────────────────────
const root = await mkdtemp(join(tmpdir(), 'idealize-ratings-'))
const home = join(root, 'home')
const dshHome = join(root, 'dsh-home')
const projectDir = join(root, 'project')
for (const dir of [home, dshHome, projectDir]) await mkdir(dir, { recursive: true })
await writeFile(join(projectDir, 'NOTES.md'), '# Notes\n')

const env = {
  ...process.env,
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  IDEALIZE_SKIP_TOUR: '1',
}
delete env.IDEALIZE_SOCK
delete env.IDEALIZE_FREETOKENS_SERVER
delete env.IDEALIZE_APP_VERSION
delete env.OPENROUTER_API_KEY
if (!env.DSH_HOME.startsWith(root) || !env.HOME.startsWith(root)) {
  throw new Error('refusing to run: DSH_HOME and HOME must both be inside the scratch root')
}
console.log(`isolated: HOME=${env.HOME}`)

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolve(port) })
    })
  })
}

const PROMPT = 'a watercolour fox'
const mock = await startMockLlmServer({
  host: '127.0.0.1', port: 0, apiKey: 'mock-key',
  // Every scripted tool call is `mock-call-1`, and the chat's title request takes one answer from the same
  // script: two answers follow each call, so the first turn makes exactly one call whenever the title asks.
  sequence: ['tool_call_success', 'success', 'success', 'tool_call_success', 'success'], repeatLast: true,
  successText: 'Here is your fox.', toolName: 'generate_image', toolArguments: JSON.stringify({ prompt: PROMPT }),
})
const FIXTURES = ['fixture-still-a', 'fixture-still-b', 'fixture-still-c']
const hostEnv = { ...env, MOCK_GATEWAY_API_KEY: 'mock-key' }
const FIRST = 'anthropic/claude-sonnet-5'
const ROUTE = {
  displayName: 'Mock Gateway',
  apiKeyEnv: 'MOCK_GATEWAY_API_KEY',
  api: 'openai-completions',
  baseURL: `${mock.baseURL}/v1`,
  models: [
    { id: FIRST, name: 'Claude Sonnet 5', contextWindow: 200000, maxTokens: 4096 },
    { id: 'openai/gpt-5.5', name: 'GPT-5.5', contextWindow: 200000, maxTokens: 4096 },
    { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', contextWindow: 200000, maxTokens: 4096 },
  ],
}

// The test route goes in the scratch settings document, which the provider plugin reads at boot.
await writeFile(join(dshHome, 'settings.yaml'), JSON.stringify({ 'llm-pi-ai': { providers: { 'mock-gateway': ROUTE } } }, null, 2))
// Three picture models from the fixture backend, joined through a patch overlay.
const patch = join(root, 'fixture.patch.yml')
await writeFile(patch, [
  '- insert:',
  '    - id: gen-fixture',
  "      name: '@idealize/gen-fixture'",
  '      config:',
  '        models:',
  ...FIXTURES.flatMap(id => [`          - id: ${id}`, '            artefact: image']),
  '',
].join('\n'))

async function boot(port: number): Promise<ChildProcess> {
  const child = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--patch', patch, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: repoRoot, env: hostEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(`  host| ${chunk.toString()}`) })
  child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(`  host! ${chunk.toString()}`) })
  const deadline = Date.now() + 180_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('the host never started listening')
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/spaces`)
      if (response.ok && Array.isArray((await response.json() as { spaces?: unknown }).spaces)) {
        const probe = await fetch(`http://127.0.0.1:${String(port)}/api/workspace.list`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace.list', payload: {} }),
        })
        if (probe.ok) return child
      }
    } catch {
      // Not listening yet; the loop is the wait.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

async function stop(child: ChildProcess): Promise<void> {
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 10_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

const port = await freePort()
const host = await boot(port)
const base = `http://127.0.0.1:${String(port)}`
console.log(`app: ${base}`)

async function rpc(method: string, payload: unknown): Promise<string> {
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
  })
  const reply = `${String(response.status)} ${await response.text()}`
  if (!response.ok) throw new Error(`${method} failed: ${reply}`)
  return reply
}
await rpc('workspace.create', { path: projectDir })
const projectName = projectDir.split('/').pop() ?? projectDir

interface RosterSpace { id: string; brainCount: number; brains: { id: string; name: string }[] }
async function roster(): Promise<RosterSpace[]> {
  return (await (await fetch(`${base}/idealize/spaces`)).json() as { spaces: RosterSpace[] }).spaces
}
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (((await roster()).find(space => space.id === 'chat')?.brainCount ?? 0) > 0) break
  await new Promise(resolve => setTimeout(resolve, 1_000))
}
const brain = (await roster()).find(space => space.id === 'chat')?.brains[0]
if (brain === undefined) throw new Error('the roster serves no Chat brains')

const browser: Browser = await chromium.launch()
async function teardown(): Promise<void> {
  await browser.close().catch(() => undefined)
  await stop(host).catch(() => undefined)
  await mock.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}
// A failed step must not leave the host running on its scratch home.
for (const event of ['unhandledRejection', 'uncaughtException'] as const) {
  process.on(event, (reason) => {
    console.error(reason)
    void teardown().then(() => { process.exit(1) })
  })
}

const failures: string[] = []
function expect(ok: boolean, what: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures.push(what)
}

interface Body { model?: string; messages?: { role: string; content: unknown }[] }
const bodyOf = (index: number): Body => (mock.requests[index]?.body ?? {}) as Body
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => (part as { text?: string }).text ?? '').join('') : ''
const ratingsFile = async (): Promise<Record<string, { tags: Record<string, { stars?: number; marks?: number }> }>> => {
  try {
    return (JSON.parse(await readFile(join(dshHome, 'model-ratings.json'), 'utf8')) as { models: Record<string, { tags: Record<string, { stars?: number; marks?: number }> }> }).models
  } catch {
    return {}
  }
}

const json = (reply: string): unknown => JSON.parse(reply.replace(/^\d+ /, ''))
interface Item { sessionId: string; running: boolean; blank: boolean; updatedAt: number; projections?: { values?: { title?: { title?: string } | string | null; space?: { space?: string } } } }
const items = async (): Promise<Item[]> => (json(await rpc('session.list', {})) as { result?: { value?: { items?: Item[] } } }).result?.value?.items ?? []
async function settle(sessionId: string): Promise<Item | undefined> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const mine = (await items()).find(item => item.sessionId === sessionId)
    if (mine !== undefined && !mine.running && !mine.blank) return mine
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  return undefined
}
interface Target { kind: string; model: string; label: string; tag: string }
const target = async (sessionId: string): Promise<Target | undefined> => {
  const response = await fetch(`${base}/idealize/router/rate-target?sessionId=${encodeURIComponent(sessionId)}`)
  return response.ok ? await response.json() as Target : undefined
}

const created = json(await rpc('session.create', { cwd: projectDir, agentPreset: 'gallery' })) as { result?: { value?: { sessionId?: string } } }
const sessionId = created.result?.value?.sessionId
if (sessionId === undefined) throw new Error(`session.create gave no id: ${JSON.stringify(created).slice(0, 300)}`)
// The provider plugin registers the scratch route a moment after the host answers, so select until it takes.
let selected = ''
for (let attempt = 0; attempt < 30 && !selected.includes('"ok":true'); attempt += 1) {
  if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1_000))
  selected = await rpc('session.selectModel', { sessionId, provider: 'mock-gateway', model: FIRST })
}
if (!selected.includes('"ok":true')) throw new Error(`session.selectModel never took: ${selected.slice(0, 300)}`)
await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: `Paint ${PROMPT}` }] })
const first = await settle(sessionId)
const made = await target(sessionId)
console.log(`  first picture: ${JSON.stringify(made)}`)
expect(made?.kind === 'image' && FIXTURES.includes(made.model), 'the first picture came from a fixture model')

const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB', colorScheme: 'light' })
const page = await context.newPage()
const pageErrors: string[] = []
page.on('pageerror', error => pageErrors.push(String(error)))
await openApp(page, base, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
const titleValue = first?.projections?.values?.title
const title = typeof titleValue === 'string' ? titleValue : titleValue?.title ?? 'New chat'
if (await page.getByText(title, { exact: true }).count() === 0) await page.getByText('project', { exact: true }).first().click()
await page.getByText(title, { exact: true }).last().click({ timeout: 15_000 }).catch(async (error: unknown) => {
  await page.screenshot({ path: join(out, 'debug-sidebar.png') })
  throw error
})
await page.locator('[data-idealize-dislike]').waitFor({ timeout: 30_000 })

// 1. The heart rates the picture's model for a picture tag.
await page.locator('[data-idealize-heart]').click()
const rateLine = page.locator('[data-rating-line="rate"]')
await rateLine.waitFor({ timeout: 15_000 })
const rateText = (await rateLine.textContent()) ?? ''
console.log(`  line: ${rateText.slice(0, 80)}`)
expect(rateText.startsWith(`Rate ${made?.label ?? '?'} for`), 'the line names the model that made the picture')
expect(rateText.includes('Illustration') && !rateText.includes('Coding'), 'the line offers picture tags')
await assertSettled(page, 'm1-rate-line')
await page.screenshot({ path: join(out, 'm1-rate-line.png') })
await page.locator('[data-rating-line] button[aria-label="Close"]').click()

// 2. The dislike offers the other two models.
await page.locator('[data-idealize-dislike]').click()
const offer = page.locator('[data-rating-line="offer"]')
const offered = await offer.waitFor({ timeout: 15_000 }).then(() => true, () => false)
const offerText = (await page.locator('[data-rating-line]').textContent()) ?? ''
console.log(`  offer: ${offerText}`)
const others = FIXTURES.filter(id => id !== made?.model)
expect(offered && others.every(id => offerText.includes(id)), 'the offer names the other two models')
expect(/Try both · (about \$|under \$0\.01|free|price unknown)/.test(offerText), 'the button carries the price')
await assertSettled(page, 'm2-offer')
await page.screenshot({ path: join(out, 'm2-offer.png') })

// 3. Their pictures show as tiles above the composer.
await page.locator('[data-rating-try]').click()
const card = page.locator('[data-slot="conversation.input.dock"] [data-compare]')
await card.waitFor({ timeout: 15_000 }).catch(async (error: unknown) => {
  await page.screenshot({ path: join(out, 'debug-media-card.png') })
  const history = json(await rpc('session.history', { sessionId })) as { result?: { value?: { events?: { type: string; data?: unknown }[] } } }
  console.log(`  last events: ${JSON.stringify((history.result?.value?.events ?? []).slice(-6).map(event => [event.type, JSON.stringify(event.data ?? null).slice(0, 160)]))}`)
  throw error
})
await card.locator('[data-compare-use="0"]:not([disabled])').waitFor({ timeout: 60_000 })
await card.locator('[data-compare-use="1"]:not([disabled])').waitFor({ timeout: 60_000 }).catch(() => undefined)
const tiles = await card.locator('img').evaluateAll(nodes => nodes.map(node => ({ src: (node as HTMLImageElement).src, loaded: (node as HTMLImageElement).naturalWidth > 0 })))
console.log(`  tiles: ${JSON.stringify(tiles)}`)
expect(tiles.length === 2 && tiles.every(tile => tile.loaded && tile.src.includes('/idealize/artefacts/raw?id=')), 'both alternatives show a loaded picture')
const keptLabel = (await card.locator('[data-compare-column="0"] span').first().textContent()) ?? ''
await assertSettled(page, 'm3-compare')
await page.screenshot({ path: join(out, 'm3-compare.png') })

// 4. Use this one keeps it, and the next picture comes from it.
await card.locator('[data-compare-use="0"]').click()
await page.locator('[data-slot="conversation.input.dock"] [data-compare-picked="0"]').waitFor({ timeout: 15_000 })
const keptText = (await page.locator('[data-slot="conversation.input.dock"] [data-compare-picked="0"]').textContent()) ?? ''
expect(await page.locator('[data-compare]').count() === 1, 'the comparison shows once, above the composer')
console.log(`  kept: ${keptText}`)
expect(keptText.includes(`You kept ${keptLabel}’s picture`), 'the card says which picture was kept')
await assertSettled(page, 'm4-kept')
await page.screenshot({ path: join(out, 'm4-kept.png') })
const ratings = JSON.parse(await readFile(join(dshHome, 'model-ratings.json'), 'utf8')) as { models: Record<string, { tags: Record<string, { marks?: number }> }> }
console.log(`  ratings: ${JSON.stringify(ratings.models)}`)
const tag = made?.tag ?? ''
expect(ratings.models[`image:${keptLabel}`]?.tags[tag]?.marks === 1, `the kept model took a quiet mark up for ${tag}`)
expect(ratings.models[`image:${made?.model ?? ''}`]?.tags[tag]?.marks === -1, `the first model took a quiet mark down for ${tag}`)
await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: `Paint ${PROMPT} again` }] })
await settle(sessionId)
await page.waitForTimeout(1_000)
const next = await target(sessionId)
console.log(`  next picture: ${next?.model ?? '?'}`)
expect(next?.model === keptLabel, 'the next picture came from the kept model')
expect(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ')})`)
await context.close()

await teardown()
console.log(failures.length === 0 ? '\nALL PASS' : `\n${String(failures.length)} FAILED:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
