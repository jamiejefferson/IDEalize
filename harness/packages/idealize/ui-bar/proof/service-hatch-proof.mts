/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly
 * and screenshot the Service hatch pane as a full chat at the app's default
 * 1280×840 — the pane, a send (real response with a key, the visible failure
 * strip without one), the probe-failure state (route aborted), and the
 * ~320px-content narrow layout.
 *
 * Usage: BASE_URL=http://127.0.0.1:<port> OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/service-hatch-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3145'
const out = process.env.OUT ?? '.idealize/proof'
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

/**
 * Clear first-run, the opening sequence and the showcase tour, then open the
 * Service hatch modal. The shared helper throws rather than let a capture land
 * mid-slide; the DeepSeek key dialog is deferred after it as before.
 */
async function openHatch(): Promise<void> {
  await settle(page, { ready: page.getByRole('button', { name: 'Service hatch' }).first() })
  const later = page.getByRole('button', { name: 'Configure later' })
  if (await later.isVisible()) await later.click()
  await page.getByRole('button', { name: 'Service hatch' }).first().click()
  await page.getByText('Warning, Service Hatch Open…').waitFor({ timeout: 30_000 })
}

// 1 — the pane as a full chat surface (source path shown, composer live).
await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await openHatch()
await page.getByPlaceholder('What shall we change?').waitFor()
await page.waitForTimeout(600)
await assertSettled(page, 'service-hatch-pane')
await page.screenshot({ path: join(out, 'service-hatch-pane.png') })

// 2 — send: with a key the transcript streams a response; without one the
// failure strip (session snapshot promptError / turn error) must be visible.
await page.getByPlaceholder('What shall we change?').fill('Say hello, and make no changes.')
await page.keyboard.press('Enter')
await Promise.race([
  page.getByRole('alert').first().waitFor({ timeout: 45_000 }),
  page.getByText('Working…').waitFor({ timeout: 45_000 }),
])
// Let the turn settle (a keyed run streams; a keyless one lands its error).
await page.waitForTimeout(12_000)
await assertSettled(page, 'service-hatch-send')
await page.screenshot({ path: join(out, 'service-hatch-send.png') })

// 3 — the probe failure is visible: abort /idealize/hatch/service and reopen.
await context.route('**/idealize/hatch/service', route => route.abort())
await page.reload({ waitUntil: 'load' })
await openHatch()
await page.getByText('route didn’t answer').waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Try again' }).waitFor()
await assertSettled(page, 'service-hatch-probe-failure')
await page.screenshot({ path: join(out, 'service-hatch-probe-failure.png') })
await context.unroute('**/idealize/hatch/service')

// 4 — narrow: at a 560px viewport the modal's content column sits at ≈320px
// (the drawer floor), proving the chat lays out sanely at that width.
await page.setViewportSize({ width: 560, height: 840 })
await page.reload({ waitUntil: 'load' })
await openHatch()
await page.getByPlaceholder('What shall we change?').waitFor()
await page.waitForTimeout(600)
await assertSettled(page, 'service-hatch-320')
await page.screenshot({ path: join(out, 'service-hatch-320.png') })

await browser.close()
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote service-hatch-pane.png, service-hatch-send.png, service-hatch-probe-failure.png, service-hatch-320.png to ${out}`)
