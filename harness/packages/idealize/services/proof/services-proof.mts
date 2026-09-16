/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly and
 * walk the whole "add a service" journey the way a person does, asserting off
 * the live DOM at each step and photographing it.
 *
 * What it proves, in JJ's terms (4 Sep 2026): picking a service and pasting a
 * key is the whole flow, and no web address is asked for anywhere on it.
 *
 *   1. Brains › Models carries one Services section.
 *   2. "Add a service" lists services by name, each saying what it makes.
 *   3. Picking one opens exactly one field, and it is the key.
 *   4. No input on that path asks for a URL, an endpoint or a protocol.
 *   5. A service whose key page is known links to it under the field.
 *   6. The web-address route is still reachable, and still marked as advanced.
 *
 * Usage: BASE_URL=http://127.0.0.1:3145 OUT=.idealize/proof pnpm exec tsx packages/idealize/services/proof/services-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { assertSettled, settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env['BASE_URL'] ?? 'http://127.0.0.1:3145'
const out = process.env['OUT'] ?? '.idealize/proof'
await mkdir(out, { recursive: true })

let pass = 0
const failures: string[] = []
/** Assert one claim, recording rather than throwing so every check reports. */
function check(claim: string, held: boolean): void {
  if (held) {
    pass += 1
    console.log(`PASS ${claim}`)
    return
  }
  failures.push(claim)
  console.log(`FAIL ${claim}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1504, height: 941 }, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
await settle(page, { ready: page.getByRole('button', { name: 'Brains' }) })
const later = page.getByRole('button', { name: 'Configure later' })
if (await later.isVisible()) await later.click()
await page.getByRole('button', { name: 'Brains' }).click()
const pane = page.getByRole('region', { name: 'Brains' })
await pane.getByRole('table', { name: 'Roles' }).waitFor({ timeout: 30_000 })
await pane.getByRole('tab', { name: 'Models' }).click()

// 1 — one Services section, and the sections it replaced are gone.
const list = pane.locator('[data-services]')
await list.waitFor({ timeout: 30_000 })
check('Brains carries one Services list', await list.count() === 1)
check('the Media keys section is gone', await pane.locator('[data-media-keys]').count() === 0)
await page.waitForTimeout(400)
await assertSettled(page, 'services-connected')
await page.screenshot({ path: join(out, 'services-connected.png') })

// 2 — the add list names services and says what each makes.
await pane.locator('[data-services-add]').click()
await page.waitForTimeout(300)
const rows = list.locator('[data-service]')
const named = await rows.locator('strong').allTextContents()
const makes = await rows.locator('small').allTextContents()
console.log('offered:', named.map((name, index) => `${name} (${makes[index] ?? ''})`).join(' · '))
check('the add list offers at least one service', named.length > 0)
check('every offered service says what it makes', makes.length === named.length && makes.every(text => text.trim().length > 0))
await assertSettled(page, 'services-add')
await page.screenshot({ path: join(out, 'services-add.png') })

// 3 and 4 — picking one asks for the key, and for nothing else.
const fal = list.locator('[data-service="fal"]')
const target = await fal.count() > 0 ? fal : rows.first()
const targetName = (await target.locator('strong').first().textContent())?.trim() ?? ''
await target.getByRole('button', { name: 'Connect' }).click()
await page.waitForTimeout(250)
const fields = target.locator('input')
check('picking a service opens exactly one field', await fields.count() === 1)
check('that field is the key, and it is masked', await fields.first().getAttribute('type') === 'password')
const labels = await list.locator('input').evaluateAll(inputs =>
  inputs.map(input => `${input.getAttribute('aria-label') ?? ''} ${input.getAttribute('placeholder') ?? ''}`))
check(
  'no field on this path asks for a URL, endpoint or protocol',
  labels.every(label => !/url|address|endpoint|protocol|base/i.test(label)),
)

// 5 — the key page, where one is known.
const link = list.locator('[data-service-key-link]')
if (await fal.count() > 0) {
  check('a known service links to its own key page', (await link.getAttribute('href')) === 'https://fal.ai/dashboard/keys')
} else {
  console.log(`SKIP key-page check: fal.ai is not offered (walked ${targetName} instead)`)
}
await assertSettled(page, 'services-key')
await page.screenshot({ path: join(out, 'services-key.png') })

// 6 — the advanced route is present and marked.
const advanced = list.locator('[data-services-advanced]')
check('the web-address route is still reachable', await advanced.count() === 1)
check('and it is marked as the other thing it is', ((await advanced.textContent()) ?? '').includes('Something else'))

check('the page raised no errors', errors.length === 0)
if (errors.length > 0) console.log('page errors:', errors.join(' | '))

await browser.close()
console.log(`\n${String(pass)} PASS, ${String(failures.length)} FAIL`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`  failed: ${failure}`)
  process.exit(1)
}
