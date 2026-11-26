/**
 * Proof run (not a vitest spec): the media Studio chat is drawn on a tuned
 * backdrop, behind its title strip, its grid and its message box.
 *
 * The page (`backdrop-entry.tsx`) mounts the shipped `GalleryView` in the
 * conversation frame's own scrolling layout, with the shipped backdrop layers painted by the
 * shipped `resolveStudioPaint`. Headless Chromium, nothing on screen. For each
 * backdrop, one adjusted backdrop, and the app theme, the driver checks:
 *   - the layers sit in the chat column, outside the scrolling view, and are
 *     the ones the backdrop asks for;
 *   - a pixel at the lamp differs from one in the far corner (the wall
 *     really is lit and really is visible through the column);
 *   - the title strip lets the backdrop through, and the seat under the
 *     message box drops its fade to the app ground;
 *   - tiles really do sit under the message box, and none of them shows
 *     there: the seat's pixels are the same with the grid scrolled to two
 *     places and with the grid hidden;
 *   - every piece of text and every icon in the view reads: its colour is
 *     measured against the pixels actually drawn behind it (a second
 *     screenshot with the text hidden), at two scroll positions and with each
 *     tile's hover buttons showing. Text must reach 4.5:1 against the median
 *     pixel behind it and 3:1 against the worst tenth; an icon 3:1 and 2:1;
 *   - a prompt is drawn at the backdrop's text size;
 *   - a message row and the message box take the panel's fill and frost.
 * It writes one screenshot per case.
 *
 * Usage: [PROOF_CHANNEL=chrome] OUT=.idealize/proof/studio-backdrop pnpm exec tsx packages/idealize/ui-gallery/proof/backdrop-proof.mts
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
const out = process.env.OUT ?? '.idealize/proof/studio-backdrop'
await mkdir(out, { recursive: true })

const root = await mkdtemp(join(tmpdir(), 'studio-backdrop-proof-'))
await build({
  entryPoints: [join(here, 'backdrop-entry.tsx')],
  outfile: join(root, 'proof.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: repoRoot,
  alias: { 'react-dom': join(repoRoot, 'packages/idealize/ui-gallery/node_modules/react-dom') },
  // The runtime package's graph reaches the app's Markdown styles; their font files are not needed here.
  loader: { '.woff2': 'empty', '.woff': 'empty', '.ttf': 'empty' },
  logLevel: 'error',
})
const bundleJs = await readFile(join(root, 'proof.js'), 'utf8')
const bundleCss = await readFile(join(root, 'proof.css'), 'utf8')

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Studio backdrop proof</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&display=swap" rel="stylesheet">
<style>${bundleCss}
html, body { margin: 0; height: 100%; overflow: hidden; }
:root { --dsh-session-header-height: 96px; }
#stage { height: 100vh; }
</style></head>
<body><div id="stage"></div><script type="module">${bundleJs}</script></body></html>`

const server = createServer((req, res) => {
  // The settings strip asks for its fields; with none served it shows its built-in ones.
  if (req.url !== '/') { res.writeHead(404).end(); return }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
})
await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const port = (server.address() as AddressInfo).port

// PROOF_CHANNEL=chrome borrows the installed Chrome where Playwright's own browser is not downloaded.
const browser = await chromium.launch(process.env.PROOF_CHANNEL === undefined ? {} : { channel: process.env.PROOF_CHANNEL })
// The tuning page's stage: a 1400px window less its 300px panel.
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', (error: unknown) => errors.push(String(error)))
await page.goto(`http://127.0.0.1:${String(port)}/`)
await page.waitForSelector('[data-gallery-prompt]')
await page.evaluate(() => document.fonts.ready)

interface Case {
  name: string
  settings: Record<string, unknown>
  layers: string[]
  /** `rgb(...)` the layer stack's wall computes to; undefined on the app theme. */
  wall?: string
  ink?: string
  /** The stats line's colour: the backdrop's secondary text. */
  stats?: string
  size?: string
  blur?: string
  lamp?: [number, number]
}

const FULL = ['light', 'seam', 'floor', 'streaks', 'vignette', 'mottle', 'grain']
const CASES: Case[] = [
  { name: 'grey', settings: { backdrop: 'grey' }, layers: FULL, wall: 'rgb(36, 36, 36)', ink: 'rgb(255, 255, 255)', stats: 'rgb(199, 199, 199)', size: '11px', blur: 'blur(6px)', lamp: [50, 9] },
  { name: 'blue', settings: { backdrop: 'blue' }, layers: FULL, wall: 'rgb(2, 67, 100)', ink: 'rgb(244, 250, 252)', stats: 'rgb(196, 196, 196)', size: '11px', blur: 'blur(0px)', lamp: [63, 34] },
  { name: 'white', settings: { backdrop: 'white' }, layers: FULL, wall: 'rgb(217, 217, 217)', ink: 'rgb(41, 41, 41)', stats: 'rgb(105, 105, 105)', size: '11px', blur: 'blur(16px)', lamp: [60, 17] },
  {
    name: 'white-adjusted',
    settings: { backdrop: 'white', tweaks: { white: { floor: false, mottle: 0, ink: '#0969DA', size: 12 } } },
    layers: ['light', 'vignette', 'grain'],
    wall: 'rgb(217, 217, 217)',
    ink: 'rgb(9, 105, 218)',
    stats: 'rgb(105, 105, 105)',
    size: '12px',
    blur: 'blur(16px)',
    lamp: [60, 17],
  },
  { name: 'none', settings: { backdrop: 'none' }, layers: [] },
]

/** Mean brightness of a 24px square of a screenshot around a point given in percent of the view. */
async function brightness(file: string, xPercent: number, yPercent: number): Promise<number> {
  const data = (await readFile(file)).toString('base64')
  return page.evaluate(async ({ source, x, y }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${source}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const pen = canvas.getContext('2d') as CanvasRenderingContext2D
    pen.drawImage(image, 0, 0)
    const left = Math.max(0, Math.min(image.width - 24, Math.round(image.width * x / 100) - 12))
    const top = Math.max(0, Math.min(image.height - 24, Math.round(image.height * y / 100) - 12))
    const pixels = pen.getImageData(left, top, 24, 24).data
    let sum = 0
    for (let index = 0; index < pixels.length; index += 4) sum += (pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0)
    return sum / (pixels.length / 4) / 3
  }, { source: data, x: xPercent, y: yPercent })
}

/**
 * The largest and the mean difference, per colour channel, between two
 * screenshots inside a rectangle.
 */
async function difference(first: string, second: string, box: { x: number; y: number; width: number; height: number }): Promise<{ max: number; mean: number }> {
  const sources = [(await readFile(first)).toString('base64'), (await readFile(second)).toString('base64')]
  return page.evaluate(async ({ pair, area }) => {
    // No inner function here: tsx wraps a named one in a helper the page does not have.
    const data: Uint8ClampedArray[] = []
    for (const source of pair) {
      const image = new Image()
      image.src = `data:image/png;base64,${source}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const pen = canvas.getContext('2d') as CanvasRenderingContext2D
      pen.drawImage(image, 0, 0)
      data.push(pen.getImageData(Math.round(area.x), Math.round(area.y), Math.round(area.width), Math.round(area.height)).data)
    }
    const a = data[0] ?? new Uint8ClampedArray()
    const b = data[1] ?? new Uint8ClampedArray()
    let max = 0
    let sum = 0
    for (let index = 0; index < a.length; index += 1) {
      const gap = Math.abs((a[index] ?? 0) - (b[index] ?? 0))
      if (gap > max) max = gap
      sum += gap
    }
    return { max, mean: sum / a.length }
  }, { pair: sources, area: box })
}

/** Scroll the chat's body and report the seat's box and how many tiles lie under it. */
async function scrollBody(top: number): Promise<{ box: { x: number; y: number; width: number; height: number }; under: number }> {
  return page.evaluate((offset) => {
    const body = document.querySelector('[data-conversation-scroll]') as HTMLElement
    body.scrollTop = offset
    const seat = (document.querySelector('[data-composer-seat]') as HTMLElement).getBoundingClientRect()
    const tiles = [...document.querySelectorAll('[data-gallery-root] audio')].map(tile => tile.getBoundingClientRect())
    return {
      box: { x: seat.x, y: seat.y, width: seat.width, height: seat.height },
      under: tiles.filter(tile => tile.bottom > seat.top + 8 && tile.top < seat.bottom - 8).length,
    }
  }, top)
}

interface Reading { label: string; colour: string; median: number; worst: number; icon: boolean }

/**
 * Measure how well everything written in the view reads. Each element that
 * holds text of its own, the message box's placeholder and each icon are
 * taken with their computed colour; the page is then captured with all text
 * and icons hidden, and the colour is compared with the pixels that were
 * behind it.
 * @param shot - where to write the capture with the text hidden.
 * @returns one reading per element, lowest contrast first.
 */
async function readability(shot: string): Promise<Reading[]> {
  const marks = await page.evaluate(() => {
    const found: { label: string; colour: string; alpha: number; box: number[]; icon: boolean }[] = []
    const scope = document.querySelector('[data-idealize-surface="chat"]') as HTMLElement
    const clear = [(document.querySelector('header') as HTMLElement).getBoundingClientRect().bottom + 4, (document.querySelector('[data-composer-seat]') as HTMLElement).getBoundingClientRect().top - 144]
    for (const element of scope.querySelectorAll<HTMLElement | SVGElement>('*')) {
      if (element.closest('audio, [data-testid="idealize-studio-backdrop"], [aria-hidden="true"]') !== null) continue
      const icon = element.tagName.toLowerCase() === 'svg'
      const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent ?? '').join('').trim()
      const hint = element instanceof HTMLTextAreaElement && element.value === '' ? element.placeholder : ''
      if (!icon && text === '' && hint === '') continue
      const box = element.getBoundingClientRect()
      if (box.width < 2 || box.height < 2 || box.bottom > innerHeight || box.top < 0) continue
      // A tile part-way under the title strip or the message box is covered there; only what is in the clear is measured.
      if (element.closest('[data-gallery-root]') !== null && (box.top < clear[0] || box.bottom > clear[1])) continue
      const style = getComputedStyle(element, hint === '' ? null : '::placeholder')
      if (getComputedStyle(element).visibility === 'hidden') continue
      let alpha = 1
      for (let node: Element | null = element; node !== null; node = node.parentElement) alpha *= Number(getComputedStyle(node).opacity)
      found.push({ label: (hint !== '' ? hint : icon ? `icon in ${(element.parentElement?.getAttribute('aria-label') ?? element.parentElement?.className ?? '').toString().slice(0, 30)}` : text).slice(0, 44), colour: style.color, alpha, box: [box.x, box.y, box.width, box.height], icon })
    }
    const hide = document.createElement('style')
    hide.id = 'proof-hide'
    hide.textContent = '* { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } '
      + '*::placeholder { color: transparent !important; } svg { visibility: hidden !important; } audio { visibility: hidden !important; }'
    document.head.append(hide)
    return found
  })
  await page.waitForTimeout(120)
  await page.screenshot({ path: shot })
  await page.evaluate(() => { document.getElementById('proof-hide')?.remove() })
  const source = (await readFile(shot)).toString('base64')
  const readings = await page.evaluate(async ({ data, items }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const pen = canvas.getContext('2d') as CanvasRenderingContext2D
    pen.drawImage(image, 0, 0)
    const probe = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
    const out: { label: string; colour: string; median: number; worst: number; icon: boolean }[] = []
    for (const item of items) {
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = item.colour
      probe.fillRect(0, 0, 1, 1)
      const ink = probe.getImageData(0, 0, 1, 1).data
      const strength = (ink[3] ?? 255) / 255 * item.alpha
      const pixels = pen.getImageData(Math.max(0, Math.floor(item.box[0] ?? 0)), Math.max(0, Math.floor(item.box[1] ?? 0)), Math.max(1, Math.floor(item.box[2] ?? 1)), Math.max(1, Math.floor(item.box[3] ?? 1))).data
      const ratios: number[] = []
      for (let index = 0; index < pixels.length; index += 4) {
        const lum: number[] = []
        for (const drawn of [true, false]) {
          let sum = 0
          for (let channel = 0; channel < 3; channel += 1) {
            const ground = pixels[index + channel] ?? 0
            // An unpremultiplied canvas read of a translucent fill: scale the colour back up before mixing it over the ground.
            const own = (ink[3] ?? 255) === 0 ? ground : (ink[channel] ?? 0)
            const value = (drawn ? own * strength + ground * (1 - strength) : ground) / 255
            const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
            sum += linear * ([0.2126, 0.7152, 0.0722][channel] ?? 0)
          }
          lum.push(sum)
        }
        const [a, b] = [Math.max(lum[0] ?? 0, lum[1] ?? 0), Math.min(lum[0] ?? 0, lum[1] ?? 0)]
        ratios.push((a + 0.05) / (b + 0.05))
      }
      ratios.sort((x, y) => x - y)
      out.push({ label: item.label, colour: item.colour, median: ratios[Math.floor(ratios.length / 2)] ?? 0, worst: ratios[Math.floor(ratios.length / 10)] ?? 0, icon: item.icon })
    }
    return out
  }, { data: source, items: marks })
  return readings.sort((a, b) => a.median - b.median)
}

interface Result { name: string; pass: boolean; failures: string[]; reading: unknown }
const results: Result[] = []

for (const item of CASES) {
  await page.evaluate((settings) => {
    (window as unknown as { __proof: { paint: (patch: unknown) => void } }).__proof.paint(settings)
  }, item.settings)
  await scrollBody(0)
  await page.waitForTimeout(500)
  const file = join(out, `${item.name}.png`)
  await page.screenshot({ path: file })
  const reading = await page.evaluate(() => {
    const column = document.querySelector('[data-idealize-surface="chat"]') as HTMLElement
    const seat = document.querySelector('[data-gallery-backdrop]')
    const stack = document.querySelector('[data-testid="idealize-studio-backdrop"]') as HTMLElement | null
    const prompt = document.querySelector('[data-gallery-prompt]') as HTMLElement
    const row = prompt.parentElement as HTMLElement
    const composer = document.querySelector('[data-composer-card]') as HTMLElement
    const header = document.querySelector('header') as HTMLElement
    const seat2 = document.querySelector('[data-composer-seat]') as HTMLElement
    const stats = document.querySelector('[data-proof-stats]') as HTMLElement
    return {
      seatInColumn: seat !== null && seat.parentElement === column,
      seatInView: document.querySelector('[data-gallery-root] [data-gallery-backdrop]') !== null,
      layers: stack === null ? [] : [...stack.querySelectorAll('[data-layer]')].map(layer => layer.getAttribute('data-layer')),
      wall: stack === null ? '' : getComputedStyle(stack).backgroundColor,
      ink: getComputedStyle(prompt).color,
      size: getComputedStyle(prompt).fontSize,
      header: getComputedStyle(header).backgroundColor,
      title: getComputedStyle(document.querySelector('[data-session-title]') as HTMLElement).color,
      seatFade: getComputedStyle(seat2).backgroundImage,
      stats: getComputedStyle(stats).color,
      rowBlur: getComputedStyle(row).backdropFilter,
      rowFill: getComputedStyle(row).backgroundColor,
      composerBlur: getComputedStyle(composer).backdropFilter,
      composerFill: getComputedStyle(composer).backgroundColor,
    }
  })
  const failures: string[] = []
  // What scrolls under the message box must not show there. The seat is
  // sampled whole, with the grid in two places and hidden.
  const shots = { first: join(out, `${item.name}-scroll-a.png`), second: join(out, `${item.name}-scroll-b.png`), bare: join(out, `${item.name}-bare.png`) }
  // Two scroll positions that each put a tile under the box; tile heights differ by backdrop.
  const placed: { top: number; under: number; box: { x: number; y: number; width: number; height: number } }[] = []
  for (let top = 140; top <= 900 && placed.length < 2; top += 67) {
    const at = await scrollBody(top)
    if (at.under > 0) placed.push({ top, ...at })
  }
  const none = { top: 0, under: 0, box: { x: 0, y: 0, width: 16, height: 40 } }
  const first = placed[0] ?? none
  const second = placed[1] ?? none
  await scrollBody(first.top)
  await page.waitForTimeout(150)
  await page.screenshot({ path: shots.first })
  await scrollBody(second.top)
  await page.waitForTimeout(150)
  await page.screenshot({ path: shots.second })
  await page.evaluate(() => { (document.querySelector('[data-gallery-root]') as HTMLElement).style.visibility = 'hidden' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: shots.bare })
  await page.evaluate(() => { (document.querySelector('[data-gallery-root]') as HTMLElement).style.visibility = '' })
  // On a backdrop the whole seat, from its top edge: the app's message box starts there. On the app
  // theme the seat's own 36px fade is the app's design and stays, so the sample starts below it.
  const band = item.wall === undefined ? 36 : 0
  const solid = { x: first.box.x, y: first.box.y + band, width: first.box.width - 16, height: first.box.height - band }
  if (first.under === 0 || second.under === 0) failures.push(`no tile lies under the message box (${String(first.under)}, ${String(second.under)}), so the check proves nothing`)
  const moved = await difference(shots.first, shots.second, solid)
  const emptied = await difference(shots.second, shots.bare, solid)
  // On a backdrop the seat's copy of the backdrop thins towards its top and stops at 90% at its foot (JJ, 26 Nov 2026),
  // so tiles stay faintly visible: they must be dimmed by more than half. The app theme's seat stays solid.
  const faint = item.wall === undefined ? 3 : 115
  if (moved.max > faint) failures.push(`the grid shows too strongly under the message box: scrolling changes its pixels by up to ${String(moved.max)}`)
  if (emptied.max > faint) failures.push(`the grid shows too strongly under the message box: hiding it changes the pixels by up to ${String(emptied.max)}`)
  Object.assign(reading, { tilesUnderBox: [first.under, second.under], seatMoved: moved, seatEmptied: emptied })
  if (item.wall !== undefined) {
    // Everything written must read, wherever on the backdrop it has scrolled to, hover buttons included.
    await page.addStyleTag({ content: '[data-gallery-actions] { opacity: 1 !important; visibility: visible !important; }' })
    const weakest: Reading[] = []
    let measured = 0
    for (const [index, top] of [0, second.top].entries()) {
      await scrollBody(top)
      await page.waitForTimeout(150)
      const all = await readability(join(out, `${item.name}-ground-${String(index)}.png`))
      measured += all.length
      weakest.push(...all)
      for (const one of all) {
        const [median, worst] = one.icon ? [3, 2] : [4.5, 3]
        if (one.median < median || one.worst < worst) failures.push(`unreadable "${one.label}" ${one.colour}: ${one.median.toFixed(2)}:1 (worst tenth ${one.worst.toFixed(2)}:1)`)
      }
    }
    // The pieces JJ reported unreadable on 26 Nov 2026 must be among those measured.
    for (const needed of ['Horse Image', 'What do you want', 'I have handed', 'Elevenlabs', 'refused', 'Thinking', 'Reveal', 'Archive', 'Sound', '6 turns']) {
      if (!weakest.some(one => one.label.includes(needed))) failures.push(`"${needed}" was never measured`)
    }
    if (measured < 30) failures.push(`only ${String(measured)} pieces of text were measured, so the check proves little`)
    await page.screenshot({ path: join(out, `${item.name}-hover.png`) })
    Object.assign(reading, { measured, weakest: weakest.sort((a, b) => a.median - b.median).map(one => `${one.label}: ${one.median.toFixed(2)}`) })
  }
  if (JSON.stringify(reading.layers) !== JSON.stringify(item.layers)) failures.push(`layers ${JSON.stringify(reading.layers)}`)
  if (reading.seatInView) failures.push('the layers sit inside the scrolling view')
  if (item.wall !== undefined) {
    if (!reading.seatInColumn) failures.push('the layers are not in the chat column')
    if (reading.wall !== item.wall) failures.push(`wall ${reading.wall}`)
    if (reading.size !== item.size) failures.push(`prompt size ${reading.size}`)
    if (reading.header !== 'rgba(0, 0, 0, 0)') failures.push(`title strip ${reading.header}`)
    if (reading.seatFade !== 'none') failures.push(`seat fade ${reading.seatFade}`)
    if (reading.rowBlur !== item.blur) failures.push(`message row frost ${reading.rowBlur}`)
    if (reading.composerBlur !== item.blur) failures.push(`message box frost ${reading.composerBlur}`)
    if (reading.composerFill !== reading.rowFill) failures.push(`message box fill ${reading.composerFill} against the row's ${reading.rowFill}`)
    const [x, y] = item.lamp ?? [50, 50]
    // Sampled in the right-hand margin at the lamp's height, clear of the text, against the far bottom-left corner.
    const lit = await brightness(file, Math.max(x, 97), y)
    const far = await brightness(file, 1, 97)
    if (lit - far < 4) failures.push(`lamp ${lit.toFixed(1)} against corner ${far.toFixed(1)}`)
    Object.assign(reading, { lit: Math.round(lit), far: Math.round(far) })
  } else {
    if (reading.rowBlur !== 'none' || reading.composerBlur !== 'none') failures.push(`frost on the app theme: ${reading.rowBlur}, ${reading.composerBlur}`)
    if (reading.composerFill !== 'rgb(255, 255, 255)') failures.push(`message box fill on the app theme ${reading.composerFill}`)
    if (reading.header === 'rgba(0, 0, 0, 0)') failures.push('the title strip is clear on the app theme')
    if (reading.title !== 'rgb(36, 41, 47)') failures.push(`the title lost the Title card's colour on the app theme: ${reading.title}`)
    if (reading.seatFade === 'none') failures.push('the seat lost its fade on the app theme')
  }
  results.push({ name: item.name, pass: failures.length === 0, failures, reading })
}

await browser.close()
server.close()
await rm(root, { recursive: true, force: true })
await writeFile(join(out, 'results.json'), `${JSON.stringify({ errors, results }, null, 2)}\n`)
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.failures.length === 0 ? '' : `: ${result.failures.join('; ')}`}`)
if (errors.length > 0) console.log(`page errors: ${errors.join(' | ')}`)
process.exit(results.every(result => result.pass) && errors.length === 0 ? 0 : 1)
