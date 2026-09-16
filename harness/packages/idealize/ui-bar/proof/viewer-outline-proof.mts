/**
 * Proof run (not a vitest spec): drive a booted IDEalize web app headlessly at
 * 1280×840 and capture the file viewer's section-title outline — the outline
 * beside a real markdown file with several heading levels, a jump recorded as
 * the scroller's before/after `scrollTop`, the auto-collapsed state after the
 * deck is dragged under 520px, and a non-markdown file with no outline column.
 * The heading texts and both scroll positions are printed so the run is on
 * record beyond the images.
 *
 * The app must be booted on a scratch `DSH_HOME` and a scratch `HOME` holding
 * the documents to open, so a proof run never reads or writes the real home.
 *
 * Usage: BASE_URL=http://127.0.0.1:3179 OUT=.idealize/proof pnpm exec tsx packages/idealize/ui-bar/proof/viewer-outline-proof.mts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'
import { settle, watchLaunch } from '../../../../.idealize/proof-settle.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3179'
const out = process.env.OUT ?? '.idealize/proof'
/** The markdown document opened from the browse pane. */
const MARKDOWN_FILE = process.env.MARKDOWN_FILE ?? 'agent-notes.md'
/** The non-markdown document opened from the same folder. */
const CODE_FILE = process.env.CODE_FILE ?? 'columns.ts'
/** The folder holding both, directly under the browse root. */
const FOLDER = process.env.FOLDER ?? 'notes'
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, locale: 'en-GB' })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error) => { errors.push(String(error)) })

/** Open the files drawer's browse pane and expand it down to the fixture folder. */
async function openBrowseFolder(): Promise<void> {
  await page.getByRole('button', { name: 'Files' }).click()
  await page.getByRole('button', { name: 'Browse this computer' }).click()
  await page.waitForTimeout(600)
  // The browse root is the booted host's home; ask the route rather than
  // hard-coding the scratch directory's name.
  const root = await page.evaluate(async () => {
    const body = await (await fetch('/idealize/bar/browse')).json() as { root: { name: string } }
    return body.root.name
  })
  await page.getByRole('button', { name: root, exact: true }).click()
  await page.getByRole('button', { name: FOLDER, exact: true }).click()
  await page.waitForTimeout(600)
}

/**
 * Open one file from the browse tree, then close the drawer: at 1280 the
 * solver squeezes the deck to its 360px floor while the drawer is open, and
 * the outline is only meant to be up once the deck is back over 520px.
 * @param name - the file row to click.
 */
async function openFile(name: string): Promise<void> {
  await openBrowseFolder()
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('region', { name: 'Files' }).getByLabel('Close panel').click()
  await page.waitForTimeout(700)
}

/** The deck column's rendered width, the number auto-collapse is measured on. */
async function deckWidth(): Promise<number> {
  return await page.evaluate(() => {
    const toolbar = document.querySelector('nav[aria-label="Outline"]')?.closest('div')
    const viewer = (toolbar ?? document.querySelector('[class*="imageStage"]'))?.parentElement
    const column = viewer?.closest('[class*="deckCol"]') ?? document.querySelector('[class*="deckCol"]')
    return column === null || column === undefined ? -1 : Math.round(column.getBoundingClientRect().width)
  })
}

/** The viewer's document scroller: the sibling the outline column sits beside. */
async function scrollTop(): Promise<number> {
  return await page.evaluate(() => {
    const outline = document.querySelector('nav[aria-label="Outline"]')
    const scroller = outline?.previousElementSibling ?? document.querySelector('nav[aria-label="Outline"]')
    return (scroller as HTMLElement | null)?.scrollTop ?? -1
  })
}

await watchLaunch(page)
await page.goto(base, { waitUntil: 'load' })
// First-run wizard, opening sequence and showcase tour, through their own
// hooks; the helper throws rather than let a capture land mid-slide.
await settle(page, { ready: page.getByRole('button', { name: 'Files' }) })
const later = page.getByRole('button', { name: 'Configure later' })
if (await later.isVisible()) await later.click()

// The sidebar's rail buys the deck its full 560px at this viewport.
await page.getByRole('button', { name: 'Collapse sidebar' }).click()
await page.waitForTimeout(500)

await openFile(MARKDOWN_FILE)

const outline = page.getByRole('navigation', { name: 'Outline' })
await outline.waitFor({ timeout: 30_000 })
await page.waitForTimeout(700)
const entries = await outline.locator('button').allTextContents()
console.log(`deck width: ${await deckWidth()}px`)
console.log(`outline entries (${entries.length}):`, JSON.stringify(entries))
await page.screenshot({ path: join(out, 'viewer-outline-headings.png') })

// The jump: the scroller sits at the top, a late heading is clicked, and the
// same scroller is read again — the two numbers are the proof, the images show it.
const before = await scrollTop()
await page.screenshot({ path: join(out, 'viewer-outline-jump-before.png') })
// A mid-document heading, so the jump can actually put it at the scroller
// top: the last heading sits inside the final screenful and stops short.
const target = entries[Math.floor(entries.length / 2)]
await outline.getByRole('button', { name: target, exact: true }).click()
await page.waitForTimeout(700)
const after = await scrollTop()
const headingTop = await page.evaluate((title: string) => {
  const outline = document.querySelector('nav[aria-label="Outline"]')
  const scroller = outline?.previousElementSibling as HTMLElement | null
  const heading = [...(scroller?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])]
    .find(element => element.textContent === title)
  if (heading === undefined || scroller === null) return NaN
  return Math.round(heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
}, target)
console.log(`jump to ${JSON.stringify(target)}: scrollTop ${before} -> ${after}, heading ${headingTop}px from the scroller top`)
await page.screenshot({ path: join(out, 'viewer-outline-jump-after.png') })
if (!(after > before)) throw new Error(`jump did not scroll the pane: ${before} -> ${after}`)

// Auto-collapse: drag the deck's column handle right until the measured deck
// width drops under the 520px threshold; the outline column unmounts on its own.
const handle = page.locator('[data-side="deck"]')
const box = await handle.boundingBox()
if (box === null) throw new Error('no deck drag handle')
const handleY = box.y + box.height / 2
const handleX = box.x + box.width / 2
await page.mouse.move(handleX, handleY)
await page.mouse.down()
await page.mouse.move(handleX + 140, handleY, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(700)
console.log(`deck width after drag: ${await deckWidth()}px`)
console.log('outline mounted while narrow:', await outline.count())
await page.screenshot({ path: join(out, 'viewer-outline-collapsed.png') })
if (await outline.count() !== 0) throw new Error('outline did not auto-collapse under 520px')

// Back to the wide deck, then a non-markdown file: no outline, no toggle.
await page.mouse.move(handleX + 140, handleY)
await page.mouse.down()
await page.mouse.move(handleX, handleY, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(700)
await openFile(CODE_FILE)
console.log(`deck width: ${await deckWidth()}px`)
console.log('outline on a non-markdown file:', await outline.count())
console.log('outline toggle on a non-markdown file:', await page.getByRole('button', { name: 'Outline' }).count())
await page.screenshot({ path: join(out, 'viewer-outline-non-markdown.png') })
if (await outline.count() !== 0) throw new Error('outline rendered for a non-markdown file')

await browser.close()
if (errors.length > 0) {
  console.error('page errors:', errors)
  process.exit(1)
}
console.log(`wrote file-viewer outline proofs to ${out}`)
