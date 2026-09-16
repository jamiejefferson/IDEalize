// Wave C4 walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9333, then: node c4-walk-proof.mjs <out-dir> [port].
// (a) drag the Opacity slider across ten pointer moves and read the thumb after
// each: it must never move backwards while acceptances land; (b) the Interface
// size commits once, on release; (c) the font picker's find field narrows the
// list and Enter picks the first match.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const OUT = process.argv[2]
const PORT = process.argv[3] ?? '9333'
mkdirSync(OUT, { recursive: true })
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find(t => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, m => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: n, method, params })) })
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value }
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (expr, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await js(`return Boolean(${expr})`)) return true; await wait(300) } return false }
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 2, mobile: false })
const shot = async (name) => { await wait(1000); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64')) }
const failures = []; const notes = {}
const check = (name, actual, expected) => { const ok = JSON.stringify(actual) === JSON.stringify(expected); if (!ok) failures.push({ name, actual, expected }); notes[name] = ok ? 'PASS' : `FAIL actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}` }
const railButton = (re) => js(`const b = [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => ${re}.test((e.getAttribute('aria-label') ?? '').trim())); if (!b) return false; b.click(); return true`)
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })

await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(6000)
if (await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)) { await js(`document.querySelector('[data-onboarding-skip-all]').click()`); await wait(2500) }
await railButton('/^Appearance$/')
await until(`document.querySelector('input[type="range"][aria-label="Opacity"]')`, 15000)
await wait(1500)
await shot('00-appearance')

// (a) drag Opacity: thumb never moves backwards
const box = await js(`const r = document.querySelector('input[type="range"][aria-label="Opacity"]').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width, value: Number(document.querySelector('input[type="range"][aria-label="Opacity"]').value) }`)
notes.opacityStart = box.value
const readings = []
const startX = box.x + 6
await mouse('mouseMoved', startX, box.y); await mouse('mousePressed', startX, box.y, { clickCount: 1 })
for (let i = 1; i <= 10; i += 1) {
  await mouse('mouseMoved', startX + (box.w - 12) * (i / 10), box.y)
  await wait(60)
  readings.push(await js(`return Number(document.querySelector('input[type="range"][aria-label="Opacity"]').value)`))
}
await mouse('mouseReleased', startX + (box.w - 12), box.y, { clickCount: 1 })
await wait(1500)
readings.push(await js(`return Number(document.querySelector('input[type="range"][aria-label="Opacity"]').value)`))
notes.opacityReadings = readings
check('(a) the thumb never moves backwards during the drag', readings.every((v, i) => i === 0 || v >= readings[i - 1]), true)
check('(a) the drag reached the top of the range and stayed there after the writes settled', readings.at(-1), 1)
notes.opacityStored = await js(`const r = await fetch('/idealize/appearance/fonts'); return r.status`)
await shot('01-opacity-dragged')
// put it back
await js(`const el = document.querySelector('input[type="range"][aria-label="Opacity"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${box.value}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))`)
await wait(800)

// (b) Interface size: the readout follows the drag, the zoom changes once, on release
const sizeBox = await js(`const el = document.querySelector('input[type="range"][aria-label="Interface size"]'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width, value: Number(el.value), min: Number(el.min), max: Number(el.max), zoom: document.getElementById('root')?.style.zoom ?? '' }`)
const zoomsDuring = []
const sx = sizeBox.x + (sizeBox.w - 12) * ((sizeBox.value - sizeBox.min) / (sizeBox.max - sizeBox.min)) + 6
await mouse('mouseMoved', sx, sizeBox.y); await mouse('mousePressed', sx, sizeBox.y, { clickCount: 1 })
for (let i = 1; i <= 4; i += 1) {
  await mouse('mouseMoved', sx + 8 * i, sizeBox.y); await wait(80)
  zoomsDuring.push(await js(`return { zoom: document.getElementById('root')?.style.zoom ?? '', value: Number(document.querySelector('input[type="range"][aria-label="Interface size"]').value) }`))
}
check('(b) the zoom does not change while the pointer is down', zoomsDuring.every(z => z.zoom === sizeBox.zoom), true)
check('(b) the thumb follows the pointer while down', zoomsDuring.at(-1).value > sizeBox.value, true)
await mouse('mouseReleased', sx + 32, sizeBox.y, { clickCount: 1 })
await wait(1500)
notes.sizeAfter = await js(`return { zoom: document.getElementById('root')?.style.zoom ?? '', value: Number(document.querySelector('input[type="range"][aria-label="Interface size"]').value) }`)
check('(b) the zoom changes once the pointer lifts', notes.sizeAfter.zoom !== sizeBox.zoom, true)
await shot('02-size-released')
// put it back through the panel
await js(`const el = document.querySelector('input[type="range"][aria-label="Interface size"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${sizeBox.value}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
await wait(1200)
notes.sizeRestored = await js(`return document.getElementById('root')?.style.zoom ?? ''`)
check('(b) the size is restored', notes.sizeRestored, sizeBox.zoom)

// (c) the font picker: find field focused, narrows, Enter picks the first match
const fontBefore = await js(`return document.querySelector('button[aria-label="Interface font"]').textContent.trim()`)
await js(`document.querySelector('button[aria-label="Interface font"]').click()`)
await until(`document.querySelector('input[type="search"]')`, 5000)
notes.fontList = await js(`return { focused: document.activeElement?.type === 'search', options: document.querySelectorAll('[role="option"]').length }`)
check('(c) the find field takes focus when the list opens', notes.fontList.focused, true)
check('(c) the full inventory lists first', notes.fontList.options > 20, true)
await send('Input.insertText', { text: 'helvetica' })
await wait(500)
notes.fontNarrowed = await js(`return [...document.querySelectorAll('[role="option"]')].map(o => o.textContent.trim())`)
check('(c) typing narrows to matching families plus the empty pick', notes.fontNarrowed.length > 1 && notes.fontNarrowed.slice(1).every(f => /helvetica/i.test(f)), true)
await shot('03-font-find')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await wait(1200)
notes.fontPicked = await js(`return { listOpen: document.querySelector('[role="listbox"]') !== null, value: document.querySelector('button[aria-label="Interface font"]').textContent.trim() }`)
check('(c) Enter picks the first match and closes the list', [notes.fontPicked.listOpen, notes.fontPicked.value], [false, notes.fontNarrowed[1]])
await shot('04-font-picked')
// restore the font
await js(`document.querySelector('button[aria-label="Interface font"]').click()`)
await until(`document.querySelector('[role="option"]')`, 5000)
await js(`[...document.querySelectorAll('[role="option"]')].find(o => o.textContent.trim() === ${JSON.stringify(fontBefore)})?.click()`)
await wait(800)

writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => typeof notes[k] === 'string' && /^(PASS|FAIL)/.test(notes[k])).length }))
for (const f of failures) console.log('FAIL', f.name, JSON.stringify(f.actual), '!=', JSON.stringify(f.expected))
ws.close(); process.exit(failures.length === 0 ? 0 : 2)
