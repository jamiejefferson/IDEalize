/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly
 * at the app's default 1280×840 and screenshot every pane whose controls
 * moved onto the shared control sheet — Schedule, Brains, Files, Service
 * hatch, Feedback, Appearance — in the light and dark themes, with the
 * composer in frame so the control consistency is visible side by side.
 *
 * Usage: BASE_URL=http://127.0.0.1:<port> OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/pane-controls-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle as settleApp, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3145'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

/**
 * Clear first-run and the opening sequence, then whatever else is up. The
 * onboarding wizard and `body[data-idealize-launch]` are handled by the shared
 * helper, which throws rather than let a capture land mid-slide; the DeepSeek
 * key dialog and the showcase tour's scrim are cleared after it as before.
 */
async function settle(): Promise<void> {
  await settleApp(page, { ready: page.getByRole('button', { name: 'Brains' }) })
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.isVisible()) await later.click()
  for (let i = 0; i < 5; i++) {
    if (await page.locator('[class*="scrim"]').count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
}

/** Open a rail pane and screenshot it once the given marker is visible. */
async function shoot(railButton: string, marker: () => ReturnType<typeof page.getByText>, file: string): Promise<void> {
  await page.getByRole('button', { name: railButton, exact: true }).click()
  await marker().first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(700)
  await assertSettled(page, file)
  await page.screenshot({ path: join(out, file) })
}

async function paneSweep(suffix: string): Promise<void> {
  await shoot('Schedule', () => page.getByText('Plan and manage recurring tasks.'), `pane-controls-schedule-${suffix}.png`)
  await shoot('Brains', () => page.getByRole('region', { name: 'Brains' }), `pane-controls-brains-${suffix}.png`)
  await shoot('Files', () => page.getByRole('region', { name: 'Files' }), `pane-controls-files-${suffix}.png`)
  await shoot('Service hatch', () => page.getByText('Warning, Service Hatch Open…'), `pane-controls-service-${suffix}.png`)
  await shoot('Feedback', () => page.getByPlaceholder('What’s on your mind?'), `pane-controls-feedback-${suffix}.png`)
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await settle()

// Open an existing chat so the docked composer card shares the frame with
// each pane (the blank-chat welcome dock renders no composer). The Notes
// session predates the newer-harness session events, so its log loads clean.
await page.getByText('Notes').first().click()
await page.getByPlaceholder('What do you want to Idealize?').waitFor({ timeout: 30_000 })
await page.waitForTimeout(500)

// ── Light theme (set explicitly): the five panes + the Appearance pane ──
await page.getByRole('button', { name: 'Appearance', exact: true }).click()
await page.getByRole('button', { name: 'Light', exact: true }).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Light', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: join(out, 'pane-controls-appearance-light.png') })
await paneSweep('light')

// ── Dark theme via the Appearance pane, then the same sweep ─────────────
await shoot('Appearance', () => page.getByRole('button', { name: 'Dark', exact: true }), 'pane-controls-appearance-reopen.png')
await page.getByRole('button', { name: 'Dark', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: join(out, 'pane-controls-appearance-dark.png') })
await paneSweep('dark')

// ── Back to light for the next session ──────────────────────────────────
await page.getByRole('button', { name: 'Appearance' }).click()
await page.getByRole('button', { name: 'Light', exact: true }).waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Light', exact: true }).click()
await page.waitForTimeout(400)

await browser.close()
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote pane control proofs to ${out}`)
