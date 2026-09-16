/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly at
 * the app's default 1280×840 and prove the welcome card's two steps — which
 * space, then which brain — in the light and dark themes.
 *
 * Per theme it captures:
 *
 * 1. **the five tiles**, with the counts the running host actually serves. The
 *    stamp records, per tile, its tag, its `disabled` and `aria-disabled`
 *    attributes, its computed opacity and pointer-events, and its count line —
 *    so "no tile is ever dimmed or disabled" is read off the rendered DOM
 *    rather than inferred from a click handler;
 * 2. **Gallery's brain step**, then a row click, landing on the Gallery view
 *    (read off `data-blank-view`, since the ring renders no tab row) with that
 *    brain current and a live composer;
 * 3. **Motion's brain step**: the route's own sentence, the Add-OpenRouter-key
 *    recovery, and a back press that returns to the five tiles;
 * 4. **Terminal's brain step** in a plain browser: `desktop-only`, stated with
 *    the way back and no key action, because a key cannot supply a shell;
 * 5. **Sound Stage with models but no brain**: the "Add a brain for Sound
 *    Stage" action, and the Brains pane it opens with the space already set.
 *
 * Setup the run arranges, all outside the code under test:
 *
 * - first-run, the opening sequence and the showcase tour are cleared by the
 *   shared settle helper (`.idealize/proof-settle.mjs`), which throws rather
 *   than let a capture land mid-slide;
 * - a scratch directory is registered as a workspace over `workspace.create`
 *   and selected, because the welcome card only asks its questions inside a
 *   project;
 * - Sound Stage's brain is taken away for capture 5 by writing an empty list
 *   into the `spaces` map of the `idealize-activity-pills` settings section —
 *   the user-facing answer to "which spaces does this brain work in" — so the
 *   host serves the models-but-no-brains state from its own roster read.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3211 OUT=.idealize/proof \
 *   pnpm exec tsx packages/idealize/ui-bar/proof/welcome-spaces-proof.mts
 */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle as settleApp, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3211'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

/** One JSON-RPC call over the app's own HTTP surface. */
async function rpc(method: string, payload: unknown): Promise<unknown> {
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
  })
  return await response.json()
}

// The project the run works inside, registered before the first render.
const projectDir = process.env.PROJECT_DIR ?? await mkdtemp(join(tmpdir(), 'welcome-spaces-'))
const projectName = projectDir.split('/').pop() ?? projectDir
await rpc('workspace.create', { path: projectDir })
console.log(`project: ${projectDir}`)

/** The roster the host serves right now, straight off the route both steps read. */
async function roster(): Promise<{ id: string; brainCount: number; models: string; reason?: string }[]> {
  const response = await fetch(new URL('/idealize/spaces', base))
  return (await response.json() as { spaces: { id: string; brainCount: number; models: string; reason?: string }[] }).spaces
}

console.log(`roster before: ${JSON.stringify(await roster())}`)

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

/** Clear first-run, the opening sequence and the tour, then open the project. */
async function settle(): Promise<void> {
  await settleApp(page, { ready: page.getByRole('button', { name: 'Brains', exact: true }) })
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  if (await page.locator('[data-launcher-step]').count() === 0) {
    await page.getByText(projectName, { exact: true }).first().click({ timeout: 30_000 })
    await page.locator('[data-launcher-step]').waitFor({ timeout: 30_000 })
  }
}

/** Set the app's theme through the Appearance pane, then close the pane. */
async function setTheme(name: 'Light' | 'Dark'): Promise<void> {
  const rail = page.getByRole('button', { name: 'Appearance', exact: true })
  await rail.click()
  const swatch = page.getByRole('button', { name, exact: true })
  await swatch.first().waitFor({ timeout: 30_000 })
  await swatch.first().click()
  await page.waitForTimeout(500)
  await rail.click()
  await page.waitForTimeout(700)
}

/**
 * Bring the welcome card back to step 1. A launched card is keyed to the
 * session it launched; since S11, New chat mints a fresh blank chat, so the
 * sidebar's New chat button is the honest reset (the pre-S11 reload trick
 * relied on the retired one-blank-chat-per-project reuse).
 */
async function newChat(): Promise<void> {
  const step = page.locator('[data-launcher-step="space"]')
  if (await step.count() > 0 && await step.first().isVisible()) return
  const back = page.locator('[data-launcher-back]')
  if (await back.count() > 0 && await back.first().isVisible()) {
    await back.first().click()
    await page.waitForTimeout(300)
    if (await step.count() > 0 && await step.first().isVisible()) return
  }
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await step.waitFor({ timeout: 30_000 })
  await page.waitForTimeout(700)
}

/**
 * What the running app renders, read back off the DOM: every tile with the
 * attributes and computed styles that could dim or disable it, the brain step
 * on screen, the view the chat landed on, and whether the composer is live.
 */
async function observe(): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const step = document.querySelector('[data-launcher-step]')
    const tiles = [...document.querySelectorAll('[data-launcher-step="space"] [data-space]')]
    const rows = [...document.querySelectorAll('[data-brain]')]
    // The ring renders no tab row (S8); the view a blank chat landed on is the
    // id ui-conversation publishes on its view area.
    const tabs = document.querySelectorAll('[role="tab"]').length
    return {
      step: step?.getAttribute('data-launcher-step') ?? null,
      stepSpace: step?.getAttribute('data-space') ?? null,
      // Everything a "dimmed tile" would have to show up in.
      tiles: tiles.map((tile) => {
        const style = getComputedStyle(tile)
        return {
          space: tile.getAttribute('data-space'),
          tag: tile.tagName,
          disabled: tile.hasAttribute('disabled'),
          ariaDisabled: tile.getAttribute('aria-disabled'),
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          count: tile.querySelector('[data-tile-count]')?.textContent ?? null,
        }
      }),
      brains: rows.map(row => ({
        brain: row.getAttribute('data-brain'),
        default: row.hasAttribute('data-brain-default'),
        text: (row.textContent ?? '').trim(),
      })),
      brainSummary: document.querySelector('[data-brain-summary]')?.textContent ?? null,
      refusal: document.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal') ?? null,
      recovery: document.querySelector('[data-launcher-recovery]')?.textContent ?? null,
      addKey: document.querySelector('[data-launcher-add-key]') !== null,
      addBrain: document.querySelector('[data-launcher-add-brain]')?.getAttribute('data-launcher-add-brain') ?? null,
      addBrainLabel: document.querySelector('[data-launcher-add-brain]')?.textContent ?? null,
      back: document.querySelectorAll('[data-launcher-back]').length,
      brainsPaneSpace: document.querySelector('[data-brains-add-space]')?.getAttribute('data-brains-add-space') ?? null,
      tabs,
      blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      // ui-agent-preset's header label, rendered from the session summary the
      // host confirmed: the chat's brain, and its roster description.
      agent: [...(document.querySelector('header')?.querySelectorAll('span[title]') ?? [])]
        .map(chip => ({ name: chip.textContent, description: chip.getAttribute('title') })),
      // Gallery takes its prompts through the ordinary composer, so it must be
      // present and visible once the chat has launched.
      composerVisible: (() => {
        const seat = document.querySelector('[data-composer-seat]')
        return seat !== null && getComputedStyle(seat).display !== 'none'
      })(),
    }
  })
}

const stamps: string[] = []

/** Capture one frame with the settle guard in front of it. */
async function shoot(file: string): Promise<void> {
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, `${file}.png`) })
  stamps.push(`${file}: ${JSON.stringify(await observe())}`)
}

/** Advance from the tiles to one space's brain step. */
async function openSpace(space: string): Promise<void> {
  await newChat()
  await page.locator(`[data-space="${space}"]`).first().click()
  await page.locator('[data-launcher-step="brain"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(300)
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await page.getByRole('button', { name: 'Brains', exact: true }).waitFor({ timeout: 60_000 })
await settle()

for (const theme of ['Light', 'Dark'] as const) {
  const suffix = theme.toLowerCase()
  await setTheme(theme)

  // 1 — the five tiles, every one live, with the host's real counts.
  await newChat()
  await shoot(`welcome-spaces-tiles-${suffix}`)

  // 2 — Gallery: the brain list, then a row click that starts the chat.
  await openSpace('gallery')
  await shoot(`welcome-spaces-gallery-brains-${suffix}`)
  await page.locator('[data-brain]').first().click()
  await page.waitForTimeout(2_500)
  await shoot(`welcome-spaces-gallery-launched-${suffix}`)

  // 3 — Motion: the plain statement, the key recovery, and the way back.
  await openSpace('motion')
  await shoot(`welcome-spaces-motion-${suffix}`)
  await page.locator('[data-launcher-refusal] [data-launcher-back]').first().click()
  await page.locator('[data-launcher-step="space"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(400)
  await shoot(`welcome-spaces-motion-back-${suffix}`)

  // 4 — Terminal in a plain browser: a legitimate state, not an error.
  await openSpace('terminal')
  await shoot(`welcome-spaces-terminal-${suffix}`)
}

// 5 — a space with models but no brains. Sound Stage's brain is moved out of
// it through the settings map the product itself writes, so the host serves
// this state from its own roster read rather than from a stubbed payload.
await rpc('settings.update', { ns: 'idealize-activity-pills', patch: { spaces: { soundstage: [] } } })
console.log(`roster after the spaces write: ${JSON.stringify(await roster())}`)
await page.reload({ waitUntil: 'load' })
await page.getByRole('button', { name: 'Brains', exact: true }).waitFor({ timeout: 60_000 })
await settle()
await openSpace('soundstage')
await shoot('welcome-spaces-soundstage-empty')
await page.locator('[data-launcher-add-brain]').first().click()
await page.locator('[data-brains-add-space]').waitFor({ timeout: 30_000 })
await page.waitForTimeout(500)
await shoot('welcome-spaces-add-brain-pane')

// Put Sound Stage's brain back, so a second run of this proof starts from the
// same roster as the first.
await rpc('settings.update', { ns: 'idealize-activity-pills', patch: { spaces: {} } })
console.log(`roster restored: ${JSON.stringify(await roster())}`)

for (const stamp of stamps) console.log(stamp)
if (errors.length > 0) console.log('PAGE ERRORS:', errors.join(' | '))
await browser.close()
