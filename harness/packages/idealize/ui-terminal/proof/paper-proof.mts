/**
 * Proof run (not a vitest spec): a blueprint theme's paper shows under the
 * real xterm grid, and the ink carries its opacity, glow and shadow.
 *
 * The page (`paper-entry.tsx`) mounts the shipped `TerminalView`, painted by
 * the shipped `resolveTerminalPaint`. Headless Chromium, nothing on screen.
 * For each blueprint theme, a flat theme, and one adjusted paper, the driver
 * checks:
 *   - xterm's scroll element is transparent over a paper and opaque without;
 *   - the paper's layers are the ones the theme asks for;
 *   - the text rows carry the paper's ink opacity;
 *   - a run of text carries the paper's shadow, in its own colour;
 *   - a pixel of empty margin differs between the lit point and the far
 *     corner (the ground is lit, so the paper really is on screen).
 * It writes one screenshot per case.
 *
 * Usage: [PROOF_CHANNEL=chrome] OUT=.idealize/proof/terminal-paper pnpm exec tsx packages/idealize/ui-terminal/proof/paper-proof.mts
 */
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
const out = process.env.OUT ?? '.idealize/proof/terminal-paper'
await mkdir(out, { recursive: true })

const root = await mkdtemp(join(tmpdir(), 'terminal-paper-proof-'))
await build({
  entryPoints: [join(here, 'paper-entry.tsx')],
  outfile: join(root, 'proof.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: repoRoot,
  alias: { 'react-dom': join(repoRoot, 'packages/idealize/ui-gallery/node_modules/react-dom') },
  logLevel: 'warning',
})
const bundleJs = await readFile(join(root, 'proof.js'), 'utf8')
const bundleCss = await readFile(join(root, 'proof.css'), 'utf8')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Terminal paper proof</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${bundleCss}
html, body { margin: 0; height: 100%; overflow: hidden; }
#stage { height: 100vh; }
</style></head>
<body><div id="stage"></div><script type="module">${bundleJs}</script></body></html>`

const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html) })
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const port = (server.address() as AddressInfo).port

// PROOF_CHANNEL=chrome borrows the installed Chrome where Playwright's own browser is not downloaded.
const browser = await chromium.launch(process.env.PROOF_CHANNEL === undefined ? {} : { channel: process.env.PROOF_CHANNEL })
const context = await browser.newContext({ viewport: { width: 980, height: 620 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error: unknown) => errors.push(String(error)))
await page.goto(`http://127.0.0.1:${String(port)}/`)
await page.waitForSelector('.xterm-rows > div')
await page.evaluate(() => document.fonts.ready)

interface Case {
  name: string
  settings: Record<string, unknown>
  paper: boolean
  layers: string[]
  inkOpacity: string
  shadow: boolean
}

const CASES: Case[] = [
  { name: 'cyanotype', settings: { theme: 'blueprint-cyanotype' }, paper: true, layers: ['grid', 'grain'], inkOpacity: '0.6', shadow: true },
  { name: 'velum', settings: { theme: 'blueprint-velum' }, paper: true, layers: ['grid', 'grain'], inkOpacity: '0.88', shadow: true },
  { name: 'carbon', settings: { theme: 'blueprint-carbon' }, paper: true, layers: ['grid', 'grain'], inkOpacity: '0.86', shadow: true },
  {
    name: 'carbon-adjusted',
    settings: { theme: 'blueprint-carbon', paper: { 'blueprint-carbon': { grid: false, crease: true, halo: 0, shadow: 0, inkOpacity: 100 } } },
    paper: true,
    layers: ['grain', 'crease'],
    inkOpacity: '1',
    shadow: false,
  },
  {
    name: 'velum-colours',
    settings: { theme: 'blueprint-velum', bgHex: '#3D2936', paper: { 'blueprint-velum': { header: '#E4DFD2', ink: '#3A1D6E', warning: '#B3261E' } } },
    paper: true,
    layers: ['grid', 'grain'],
    inkOpacity: '0.88',
    shadow: true,
  },
  { name: 'ink-flat', settings: { theme: 'ink' }, paper: false, layers: [], inkOpacity: '1', shadow: false },
]

interface Result { name: string; pass: boolean; failures: string[]; reading: unknown }
const results: Result[] = []

for (const item of CASES) {
  await page.evaluate((settings) => {
    (window as unknown as { __proof: { paint: (patch: unknown) => void } }).__proof.paint(settings)
  }, item.settings)
  await page.waitForTimeout(400)
  const file = join(out, `${item.name}.png`)
  await page.screenshot({ path: file })
  const reading = await page.evaluate(() => {
    const scroll = document.querySelector('.xterm-scrollable-element') as HTMLElement
    const rows = document.querySelector('.xterm-rows') as HTMLElement
    const run = [...document.querySelectorAll('.xterm-rows span')].find(span => (span.textContent ?? '').includes('git status')) as HTMLElement
    const red = [...document.querySelectorAll('.xterm-rows span')].find(span => (span.textContent ?? '').includes('.DS_Store')) as HTMLElement
    const block = [...document.querySelectorAll('.xterm-rows span')].find(span => (span.textContent ?? '').includes('Jump to bottom')) as HTMLElement
    const paper = document.querySelector('[data-testid="idealize-terminal-paper"]')
    return {
      scrollBackground: getComputedStyle(scroll).backgroundColor,
      layers: paper === null ? null : [...paper.children].map(child => child.getAttribute('data-layer')),
      ground: paper === null ? '' : getComputedStyle(paper).backgroundImage.slice(0, 60),
      rowsOpacity: getComputedStyle(rows).opacity,
      runShadow: getComputedStyle(run).textShadow,
      redColour: getComputedStyle(red).color,
      redShadow: getComputedStyle(red).textShadow,
      blockColour: getComputedStyle(block).backgroundColor,
      blockCover: getComputedStyle(block).backgroundImage,
    }
  })
  const failures: string[] = []
  const transparent = reading.scrollBackground === 'rgba(0, 0, 0, 0)'
  if (item.paper && !transparent) failures.push(`scroll element is ${reading.scrollBackground} over a paper`)
  if (!item.paper && transparent) failures.push('scroll element is transparent on a flat theme')
  if (JSON.stringify(reading.layers ?? []) !== JSON.stringify(item.layers)) failures.push(`layers ${JSON.stringify(reading.layers)}`)
  if (item.paper && !reading.ground.startsWith('radial-gradient')) failures.push(`ground ${reading.ground}`)
  if (reading.rowsOpacity !== item.inkOpacity) failures.push(`rows opacity ${reading.rowsOpacity}`)
  if (item.shadow !== (reading.runShadow !== 'none')) failures.push(`text shadow ${reading.runShadow}`)
  // The glow is drawn in the run's own colour: the red run's shadow carries red's channels.
  if (item.shadow) {
    // The browser reports the mixed glow as `color(srgb r g b / a)` with channels from 0 to 1.
    const ink = /rgb\((\d+), (\d+), (\d+)\)/.exec(reading.redColour)?.slice(1).map(Number)
    const glow = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(reading.redShadow)?.slice(1).map(value => Math.round(Number(value) * 255))
    if (ink === undefined || JSON.stringify(glow) !== JSON.stringify(ink)) failures.push(`red glow ${reading.redShadow} for ${reading.redColour}`)
  }
  // The program's block keeps its colour underneath; a paper theme lays the wash over it.
  if (reading.blockColour !== 'rgb(55, 55, 55)') failures.push(`block colour ${reading.blockColour}`)
  if (item.paper !== reading.blockCover.startsWith('linear-gradient')) failures.push(`block cover ${reading.blockCover}`)
  results.push({ name: item.name, pass: failures.length === 0, failures, reading })
}

await browser.close()
server.close()
await rm(root, { recursive: true, force: true })
await writeFile(join(out, 'results.json'), `${JSON.stringify({ errors, results }, null, 2)}\n`)
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.failures.length === 0 ? '' : `: ${result.failures.join('; ')}`}`)
if (errors.length > 0) console.log(`page errors: ${errors.join(' | ')}`)
process.exit(results.every(result => result.pass) && errors.length === 0 ? 0 : 1)
