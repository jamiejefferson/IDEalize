/**
 * Proof run (not a vitest spec): the terminal grid keeps its last row inside
 * the visible column, and the PTY is told the grid's size, through every way
 * the grid's box or cell changes.
 *
 * The page (`entry.tsx`) mounts the shipped `TerminalView` inside the shipped
 * conversation column styles, and the shipped Terminal pane inside a
 * drawer-like column, over a PTY stand-in that redraws an ask bar on the last
 * row of whatever size it was last told. Headless Chromium, nothing on screen.
 *
 * After every step the driver checks:
 *   - the grid's last row ends inside the visible frame;
 *   - the frame has nothing to scroll (the view area did not outgrow it);
 *   - the ask bar sits on the grid's last row (the PTY drew for this size);
 *   - the last size the PTY was told equals the grid's rows and columns.
 *
 * Usage: OUT=.idealize/proof/terminal-resize pnpm exec tsx packages/idealize/ui-terminal/proof/resize-proof.mts
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Resolved from pnpm's virtual store: esbuild arrives transitively (vite).
import { build } from '../../../../node_modules/.pnpm/node_modules/esbuild/lib/main.js'
// Resolved from apps/web's devDependency: the proof borrows the web e2e browser.
import { chromium } from '../../../../apps/web/node_modules/playwright/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const out = process.env.OUT ?? '.idealize/proof/terminal-resize'
await mkdir(out, { recursive: true })

const root = await mkdtemp(join(tmpdir(), 'terminal-resize-proof-'))
await build({
  entryPoints: [join(here, 'entry.tsx')],
  outfile: join(root, 'proof.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: repoRoot,
  // This package renders through its host and has no react-dom of its own; the
  // proof page borrows the Gallery package's copy (same React 18 line).
  alias: { 'react-dom': join(repoRoot, 'packages/idealize/ui-gallery/node_modules/react-dom') },
  logLevel: 'warning',
})
const bundleJs = await readFile(join(root, 'proof.js'), 'utf8')
const bundleCss = await readFile(join(root, 'proof.css'), 'utf8')
const themeDir = join(repoRoot, 'packages/client/ui-theme/src/styles')
const baseCss = await readFile(join(themeDir, 'base.css'), 'utf8')
const platformCss = await readFile(join(themeDir, 'design-platform.css'), 'utf8')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Terminal resize proof</title>
<style>${baseCss}\n${platformCss}\n${bundleCss}
@font-face { font-family: 'ProofLate'; src: url('/late.ttf'); }
html, body { margin: 0; height: 100%; overflow: hidden; }
#stage { height: 100vh; }
</style></head>
<body><div id="stage"></div><script type="module">${bundleJs}</script></body></html>`

// A face whose advance differs from the monospace fallback, served late, stands
// in for a web font that finishes loading after the grid opened.
const LATE_FACE = '/System/Library/Fonts/Supplemental/Arial.ttf'
const LATE_MS = 1500
const lateFace = existsSync(LATE_FACE) ? await readFile(LATE_FACE) : undefined

const server = createServer((req, res) => {
  if (req.url === '/late.ttf' && lateFace !== undefined) {
    setTimeout(() => { res.writeHead(200, { 'content-type': 'font/ttf' }).end(lateFace) }, LATE_MS)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
})
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const port = (server.address() as AddressInfo).port

interface Reading {
  frameBottom: number
  lastRowBottom: number
  scrollOverflow: number
  gridRows: number
  gridCols: number
  askRow: number
  pty: { cols: number; rows: number } | undefined
  resizeCalls: number
}

interface Check { layout: string; step: string; pass: boolean; failures: string[]; reading: Reading }

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error: unknown) => errors.push(String(error)))

async function settle(): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
  }))
  await page.waitForTimeout(200)
}

async function read(): Promise<Reading> {
  return await page.evaluate(() => {
    const frame = document.querySelector('[data-proof-frame]') as HTMLElement
    const rows = [...document.querySelectorAll('.xterm-rows > div')] as HTMLElement[]
    const last = rows.at(-1) as HTMLElement
    const screen = document.querySelector('.xterm-screen') as HTMLElement
    // The cursor's span is one cell wide whatever face is loaded (the DOM
    // renderer spaces every glyph out to the cell it measured).
    const cell = (document.querySelector('.xterm-cursor') as HTMLElement).getBoundingClientRect().width
    const proof = (window as unknown as { __proof: { resizes: { cols: number; rows: number }[]; opened: { cols: number; rows: number } | undefined } }).__proof
    return {
      frameBottom: Math.min(frame.getBoundingClientRect().bottom, window.innerHeight),
      lastRowBottom: last.getBoundingClientRect().bottom,
      scrollOverflow: frame.scrollHeight - frame.clientHeight,
      gridRows: rows.length,
      gridCols: Math.round(screen.getBoundingClientRect().width / cell),
      askRow: rows.findIndex(row => (row.textContent ?? '').includes('ASK-BAR')) + 1,
      pty: proof.resizes.at(-1) ?? proof.opened,
      resizeCalls: proof.resizes.length,
    }
  })
}

const checks: Check[] = []

async function check(layout: string, step: string): Promise<void> {
  await settle()
  const reading = await read()
  const failures: string[] = []
  if (reading.lastRowBottom > reading.frameBottom + 0.5) {
    failures.push(`last row ends ${(reading.lastRowBottom - reading.frameBottom).toFixed(1)}px below the visible frame`)
  }
  if (reading.scrollOverflow > 0) failures.push(`frame scrolls by ${String(reading.scrollOverflow)}px`)
  if (reading.askRow !== reading.gridRows) failures.push(`ask bar on row ${String(reading.askRow)} of ${String(reading.gridRows)}`)
  if (reading.pty?.rows !== reading.gridRows || reading.pty.cols !== reading.gridCols) {
    failures.push(`PTY told ${String(reading.pty?.cols)}x${String(reading.pty?.rows)}, grid is ${String(reading.gridCols)}x${String(reading.gridRows)}`)
  }
  checks.push({ layout, step, pass: failures.length === 0, failures, reading })
  await page.screenshot({ path: join(out, `${layout}-${String(checks.length).padStart(2, '0')}-${step.replace(/[^a-z0-9]+/gi, '-')}.png`) })
}

const paint = async (patch: Record<string, unknown>): Promise<void> => {
  await page.evaluate((next) => {
    (window as unknown as { __proof: { paint: (patch: Record<string, unknown>) => void } }).__proof.paint(next)
  }, patch)
}
const stageStyle = async (style: Record<string, string>): Promise<void> => {
  await page.evaluate((next) => {
    const stage = document.getElementById('stage') as HTMLElement
    for (const [name, value] of Object.entries(next)) stage.style.setProperty(name, value)
  }, style)
}

for (const layout of ['chat', 'pane']) {
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.goto(`http://127.0.0.1:${String(port)}/?layout=${layout}`, { waitUntil: 'load' })
  await page.locator('.xterm-rows > div').first().waitFor({ timeout: 20_000 })
  await check(layout, 'open 1280x840')

  await page.setViewportSize({ width: 1280, height: 520 })
  await check(layout, 'window shrinks to 1280x520')

  await page.setViewportSize({ width: 1280, height: 900 })
  await check(layout, 'window grows to 1280x900')

  await stageStyle({ width: '640px' })
  await check(layout, 'column narrows to 640 (drawer opens)')
  await stageStyle({ width: '' })
  await check(layout, 'column widens again (drawer closes)')

  await paint({ fontSize: 20 })
  await check(layout, 'terminal font 14 to 20')
  await paint({ fontSize: 11 })
  await check(layout, 'terminal font 20 to 11')
  await paint({ fontSize: 14, lineHeight: 1.6 })
  await check(layout, 'line height 1.2 to 1.6')
  await paint({ margin: 48 })
  await check(layout, 'margin 16 to 48')

  await stageStyle({ display: 'none' })
  await page.setViewportSize({ width: 1000, height: 600 })
  await settle()
  await stageStyle({ display: '' })
  await check(layout, 'hidden, window resized to 1000x600, shown')

  // The appearance panel zooms a surface inside a fixed frame, so the zoomed
  // stage keeps the window's box: its own lengths shrink by the zoom.
  await stageStyle({ zoom: '1.25', height: 'calc(100vh / 1.25)', width: 'calc(100vw / 1.25)' })
  await check(layout, 'surface zoom 1.25')
  await stageStyle({ zoom: '', height: '', width: '' })
  await check(layout, 'surface zoom back to 1')

  await page.setViewportSize({ width: 420, height: 320 })
  await check(layout, 'mini window 420x320')
}

if (lateFace === undefined) {
  console.log(`SKIP  late font: ${LATE_FACE} is not on this machine`)
} else {
  await page.setViewportSize({ width: 1280, height: 840 })
  await page.goto(`http://127.0.0.1:${String(port)}/?layout=chat&font=late`, { waitUntil: 'commit' })
  await page.locator('.xterm-rows > div').first().waitFor({ timeout: 20_000 })
  await check('chat', 'late font: opened on the fallback face')
  await page.waitForFunction(() => document.fonts.check('14px ProofLate'), undefined, { timeout: 20_000 })
  await check('chat', 'late font: the face has loaded')
}

await browser.close()
server.close()
await rm(root, { recursive: true, force: true })

const passed = checks.filter(c => c.pass).length
const result = { passed, failed: checks.length - passed, pageErrors: errors, checks }
await writeFile(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.layout}  ${c.step}${c.pass ? '' : `  — ${c.failures.join('; ')}`}`)
console.log(`${String(passed)} pass, ${String(checks.length - passed)} fail, ${String(errors.length)} page errors → ${out}`)
process.exit(checks.length === passed && errors.length === 0 ? 0 : 1)
