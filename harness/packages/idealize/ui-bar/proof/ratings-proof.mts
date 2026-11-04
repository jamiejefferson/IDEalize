/**
 * Proof run (not a vitest spec): boot the REAL assembled IDEalize app on
 * scratch data and drive ratings and the dislike in a Chat chat, in both
 * themes, at the packaged window's 1280×840.
 *
 * What it proves, per theme:
 *
 * 1. **The heart sends nothing.** Pressing it opens the router's line for the
 *    model behind the last answer; no new request reaches the model.
 * 2. **Stars save.** Tapping a star writes that many stars for the line's tag
 *    to `model-ratings.json` in the scratch harness home (4 in light, 5 in dark).
 * 3. **The dislike offers another model.** The offer row names the model and
 *    carries the price on its button.
 * 4. **The alternative answers the same ask.** Its request reaches the model
 *    server on the other model, told to answer in text, ending on the ask.
 * 5. **Use this one keeps it.** The card folds to its kept line, the ratings
 *    file holds a quiet mark each way, and the next turn runs on the kept
 *    model with the kept answer in what it reads.
 *
 * The model is `@deepseek-ai/dsh-llm-mock-server` behind a test route declared
 * in the scratch app's provider settings, listing three models the router's
 * score table knows, so the offer has two other models to try.
 *
 * Isolation: the run refuses to start unless `DSH_HOME` and `HOME` both point
 * inside the temporary directory it made, and deletes that directory at the end.
 *
 * The app serves the built `lib/` bundles: run `pnpm run build` first.
 *
 * Usage: OUT=.idealize/proof/ratings pnpm exec tsx packages/idealize/ui-bar/proof/ratings-proof.mts
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

const ANSWER = 'Rain taps the window, slow and grey.'
const mock = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: ANSWER })
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

async function boot(port: number): Promise<ChildProcess> {
  const child = spawn(
    'node',
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'idealize', '--host', '127.0.0.1', '--port', String(port)],
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

async function launch(page: Page): Promise<void> {
  const step = page.locator('[data-hero-below]')
  if (!(await step.count() > 0 && await step.first().isVisible())) {
    const newChat = page.getByRole('button', { name: 'New chat', exact: true })
    if (await newChat.count() > 0) await newChat.first().click()
    if (await step.count() === 0 && await page.getByText(projectName, { exact: true }).count() > 0) {
      await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    }
    await step.waitFor({ timeout: 30_000 })
    await page.waitForTimeout(300)
  }
  await page.locator(`[data-brain-card="${brain!.id}"] [aria-pressed]`).first().click()
  await page.waitForTimeout(2_500)
}

async function turn(page: Page, text: string): Promise<void> {
  const composer = page.locator('textarea:visible').first()
  await composer.waitFor({ timeout: 30_000 }).catch(async (error: unknown) => {
    await page.screenshot({ path: join(out, 'debug-composer.png') })
    throw error
  })
  await composer.click()
  await composer.fill(text)
  await page.keyboard.press('Meta+Enter')
  await page.waitForFunction(() => document.querySelectorAll('[data-running], [data-turn-running]').length === 0, undefined, { timeout: 90_000 })
    .catch(() => undefined)
  await page.waitForTimeout(2_500)
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

for (const theme of ['light', 'dark'] as const) {
  console.log(`\n── ${theme} ────────────────────────────────────────────────`)
  // Each theme taps a different star: tapping the star a model already holds clears it.
  const stars = theme === 'light' ? 4 : 5
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB', colorScheme: theme })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(String(error)))
  await openApp(page, base, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  await launch(page)
  // The scratch app reaches only the scripted model, behind the test route: put the new chat on it.
  const listed = JSON.parse((await rpc('session.list', {})).replace(/^\d+ /, '')) as { result?: { value?: { items?: { sessionId: string; updatedAt: number }[] } } }
  const sessionId = [...listed.result?.value?.items ?? []].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.sessionId
  if (sessionId === undefined) throw new Error(`no session after launch: ${JSON.stringify(listed).slice(0, 400)}`)
  const models = (await rpc('session.models', { sessionId })).replace(/^\d+ /, '')
  console.log(`  session ${sessionId}; models: ${models.slice(0, 400)}`)
  console.log(`  select: ${await rpc('session.selectModel', { sessionId, provider: 'mock-gateway', model: FIRST })}`)
  // Every shipped brain asks for OpenRouter, so the welcome card cannot start this chat: the first message goes
  // through the app's own prompt call, and the chat opens from the sidebar once it has answered.
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: 'Write one line about rain' }] })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = JSON.parse((await rpc('session.list', {})).replace(/^\d+ /, '')) as { result?: { value?: { items?: { sessionId: string; running: boolean; blank: boolean }[] } } }
    const mine = state.result?.value?.items?.find(item => item.sessionId === sessionId)
    if (mine !== undefined && !mine.running && !mine.blank) break
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  await openApp(page, base, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  console.log(`  url: ${page.url()}`)
  const listedNow = JSON.parse((await rpc('session.list', {})).replace(/^\d+ /, '')) as {
    result?: { value?: { items?: { sessionId: string; projections?: { values?: { title?: { title?: string } | string | null } } }[] } }
  }
  const titleValue = listedNow.result?.value?.items?.find(item => item.sessionId === sessionId)?.projections?.values?.title
  const title = typeof titleValue === 'string' ? titleValue : titleValue?.title ?? 'New chat'
  console.log(`  title: ${title}`)
  if (await page.getByText(title, { exact: true }).count() === 0) await page.getByText('project', { exact: true }).first().click()
  await page.getByText(title, { exact: true }).last().click({ timeout: 15_000 }).catch(async (error: unknown) => {
    await page.screenshot({ path: join(out, 'debug-sidebar.png') })
    throw error
  })
  await page.locator('textarea:visible').first().waitFor({ timeout: 30_000 }).catch(async (error: unknown) => {
    await page.screenshot({ path: join(out, 'debug-open.png') })
    throw error
  })
  await page.waitForTimeout(1_500)
  const firstModel = bodyOf(mock.requests.length - 1).model ?? ''
  console.log(`  first answer on ${firstModel}`)

  // 1. The heart opens the line and sends nothing.
  const before = mock.requests.length
  expect(await page.locator('[data-idealize-heart]').count() === 1, 'the heart sits in the composer')
  expect(await page.locator('[data-idealize-dislike]').count() === 1, 'the dislike sits beside it')
  await page.getByText(ANSWER).first().hover()
  const thumbs = await page.locator('button[aria-label="Good response"], button[aria-label="Bad response"]').count()
  expect(thumbs === 0, `the reply shows no thumbs (${String(thumbs)})`)
  await page.locator('[data-idealize-heart]').click()
  const rateLine = page.locator('[data-rating-line="rate"]')
  await rateLine.waitFor({ timeout: 15_000 })
  const rateText = (await rateLine.textContent()) ?? ''
  console.log(`  line: ${rateText}`)
  expect(rateText.startsWith('Rate Claude Sonnet 5 for'), 'the line names the model behind the last answer')
  await assertSettled(page, '01-rate-line')
  await page.screenshot({ path: join(out, `01-rate-line-${theme}.png`) })
  await page.waitForTimeout(1_000)
  expect(mock.requests.length === before, 'pressing the heart sent the model nothing')

  // 2. The tapped stars save.
  const tag = await rateLine.locator('select').inputValue()
  await page.locator(`[data-rating-star="${String(stars)}"]`).click()
  await page.locator('[data-rating-line="saved"]').waitFor({ timeout: 10_000 })
  await assertSettled(page, '02-saved')
  await page.screenshot({ path: join(out, `02-saved-${theme}.png`) })
  const afterStars = await ratingsFile()
  const starred = Object.entries(afterStars).find(([key]) => key.includes('sonnet'))
  console.log(`  ratings: ${JSON.stringify(afterStars)}`)
  expect(starred?.[1].tags[tag]?.stars === stars, `${String(stars)} stars for ${tag} are on disk`)

  // 3. The dislike offers the other model with a price.
  await page.locator('[data-rating-line="saved"] button[aria-label="Close"]').click()
  await page.locator('[data-idealize-dislike]').click()
  const offer = page.locator('[data-rating-line="offer"]')
  const offered = await offer.waitFor({ timeout: 15_000 }).then(() => true, () => false)
  const offerText = offered ? (await offer.textContent()) ?? '' : (await page.locator('[data-rating-line]').textContent()) ?? ''
  console.log(`  offer: ${offerText}`)
  expect(offered && /Try (GPT-5\.5|Gemini 3\.6 Flash) and (GPT-5\.5|Gemini 3\.6 Flash) on the same ask\?/.test(offerText), 'the offer names two other models')
  expect(/Try both · (about \$|under \$0\.01|free|price unknown)/.test(offerText), 'the button carries the price')
  await assertSettled(page, '03-offer')
  await page.screenshot({ path: join(out, `03-offer-${theme}.png`) })

  // 4. The alternative answers the same ask.
  const beforeCompare = mock.requests.length
  await page.locator('[data-rating-try]').click()
  await page.locator('[data-compare]').waitFor({ timeout: 15_000 })
  await page.locator('[data-compare-use="0"]:not([disabled])').waitFor({ timeout: 60_000 })
  await page.locator('[data-compare-use="1"]:not([disabled])').waitFor({ timeout: 60_000 }).catch(() => undefined)
  const altBodies = mock.requests.slice(beforeCompare).map(record => record.body as Body)
  const keptLabel = (await page.locator('[data-compare-column="0"] span').first().textContent()) ?? ''
  const alt = { model: ROUTE.models.find(one => one.name === keptLabel)?.id }
  console.log(`  alternatives ran on ${altBodies.map(body => body.model ?? '?').join(', ')}; column 0 is ${keptLabel}`)
  expect(altBodies.length === 2 && altBodies.every(body => body.model !== undefined && body.model !== firstModel), 'both alternatives ran on other models')
  expect(altBodies.every(body => textOf((body.messages ?? []).find(message => message.role === 'system')?.content).includes('No tools can run for this answer')),
    'each alternative was told to answer in text')
  expect(altBodies.every(body => textOf((body.messages ?? []).at(-1)?.content).includes('Write one line about rain')), 'each alternative read the same ask last')
  await page.locator('[data-compare]').scrollIntoViewIfNeeded()
  await assertSettled(page, '04-compare')
  await page.screenshot({ path: join(out, `04-compare-${theme}.png`) })

  // 5. Use this one keeps it.
  await page.locator('[data-compare-use="0"]').click()
  await page.locator('[data-compare-picked="0"]').waitFor({ timeout: 15_000 })
  const kept = (await page.locator('[data-compare-picked="0"]').textContent()) ?? ''
  console.log(`  kept: ${kept}`)
  expect(kept.includes('this chat now runs on it'), 'the card says the chat runs on the kept model')
  await assertSettled(page, '05-kept')
  await page.screenshot({ path: join(out, `05-kept-${theme}.png`) })
  const marks = await ratingsFile()
  const squashBefore = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const markIn = (file: typeof marks, model: string) =>
    Object.entries(file).find(([key]) => squashBefore(key).endsWith(squashBefore(model.split('/').pop() ?? model)))?.[1].tags[tag]?.marks ?? 0
  console.log(`  ratings after the pick: ${JSON.stringify(marks)}`)
  expect(markIn(marks, alt.model ?? '') - markIn(afterStars, alt.model ?? '') === 1, 'the kept model took a quiet mark up')
  expect(markIn(marks, firstModel) - markIn(afterStars, firstModel) === -1, 'the disliked model took a quiet mark down')
  const beforeNext = mock.requests.length
  await turn(page, 'And one more')
  const next = bodyOf(beforeNext)
  console.log(`  next turn on ${next.model ?? '?'}`)
  expect(next.model === alt.model, 'the next turn ran on the kept model')
  expect((next.messages ?? []).some(message => textOf(message.content).includes('kept this answer, from')), 'the next turn read the kept answer')
  expect(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ')})`)
  await context.close()
}

await teardown()
console.log(failures.length === 0 ? '\nALL PASS' : `\n${String(failures.length)} FAILED:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
