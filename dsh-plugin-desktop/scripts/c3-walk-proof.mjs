// Wave C3 walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9333, then: node c3-walk-proof.mjs <out-dir> [port].
// Works only in the scratch copy's own project folder (a temp dir registered
// through the window's project picker is out of reach here, so the walk
// uses the current project's tree and cleans up what it creates).
// (a) the drawer handle sits on the centre | rail border; with the deck open
// the deck handle does and the drawer handle sits on the deck | drawer border;
// (b) the row menu carries the new items; (c) New file here → rename →
// duplicate → the viewer edits and saves → move to Trash, on files the walk
// creates; (d) a row drag onto the composer card adds the path to the draft.
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
const clickMenu = (label) => js(`const b = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true`)
const contextMenuOn = (path) => js(`const row = document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(path)}) + ']'); if (!row) return false; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 40, clientY: r.y + r.height / 2 })); return true`)
const setValue = (sel, value) => js(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true`)
// Layout px throughout (offsetLeft/offsetWidth): the appearance zoom scales
// bounding rects but not the grid tracks or the handles' inline `left`.
const layout = () => js(`
  const col = name => document.querySelector('[class*="' + name + '"]')
  const left = e => { let x = 0; for (let n = e; n; n = n.offsetParent) x += n.offsetLeft; return x }
  const rail = col('railCol'); const drawer = col('drawerCol'); const deck = col('deckCol')
  const handle = side => { const h = document.querySelector('[data-side="' + side + '"]'); return h ? Math.round(parseFloat(h.style.left)) : null }
  return { zoom: document.getElementById('root')?.style.zoom || '1', railLeft: Math.round(left(rail)), railWidth: rail.offsetWidth,
    drawerLeft: Math.round(left(drawer)), deckLeft: deck && deck.offsetWidth > 0 ? Math.round(left(deck)) : null,
    drawerHandle: handle('drawer'), deckHandle: handle('deck') }`)

await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(6000)
if (await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)) { await js(`document.querySelector('[data-onboarding-skip-all]').click()`); await wait(2500) }

// (a) handles: drawer only, then deck + drawer
await railButton('/^Files$/')
await until(`document.querySelector('[data-path]')`, 15000); await wait(1500)
notes.drawerOnly = await layout()
check('(a) with the drawer alone, its handle sits on the centre | rail border', Math.abs(notes.drawerOnly.drawerHandle - notes.drawerOnly.railLeft) <= 2, true)
await shot('00-files-drawer')
// (b)+(c): the row menu, and a full life of a file the walk creates
const projectRoot = await js(`return document.querySelector('[data-path]').getAttribute('data-path')`)
notes.projectRoot = projectRoot
await contextMenuOn(projectRoot); await wait(400)
notes.folderMenu = await js(`return [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim())`)
check('(b) a folder row menu', notes.folderMenu, ['Reveal in Finder', 'Copy path', 'New file here', 'New folder here', 'Rename…', 'Duplicate', 'Move to Trash'])
await shot('02-folder-menu')
await clickMenu('New file here'); await wait(400)
await setValue('form[data-sheet="file"] input', 'c3-proof.txt')
await js(`document.querySelector('form[data-sheet="file"]').requestSubmit()`)
const created = `${projectRoot}/c3-proof.txt`
await until(`document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(created)}) + ']')`, 10000)
await wait(1000)
check('(c) New file here lands in the tree', await js(`return document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(created)}) + ']') !== null`), true)
// the viewer opened it, so the deck is up: measure the handles again
await until(`document.querySelector('[data-side="deck"]')`, 10000); await wait(1200)
notes.withDeck = await layout()
check('(a) with the deck open, the deck handle sits on the centre | rail border', Math.abs(notes.withDeck.deckHandle - notes.withDeck.railLeft) <= 2, true)
check('(a) and the drawer handle sits on the deck | drawer border', Math.abs(notes.withDeck.drawerHandle - notes.withDeck.drawerLeft) <= 2, true)
await shot('01-deck-open')
// the viewer opened it: edit, type, save
await until(`document.querySelector('[data-viewer-edit]')`, 10000)
await js(`document.querySelector('[data-viewer-edit]').click()`); await wait(400)
await setValue('[class*="deckCol"] textarea', 'written by the C3 walk\n')
await js(`document.querySelector('[data-viewer-save]').click()`)
await until(`[...document.querySelectorAll('[role="status"]')].some(e => e.textContent.trim() === 'Saved')`, 8000)
notes.savedText = await js(`const r = await fetch('/idealize/bar/file?path=' + encodeURIComponent(${JSON.stringify(created)})); return (await r.json()).text`)
check('(c) the viewer saved the text to disk', notes.savedText, 'written by the C3 walk\n')
await shot('03-edited-saved')
// file menu → rename
await contextMenuOn(created); await wait(400)
notes.fileMenu = await js(`return [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim())`)
check('(b) a file row menu', notes.fileMenu, ['Open', 'Add to chat', 'Reveal in Finder', 'Copy path', 'Rename…', 'Duplicate', 'Move to Trash'])
await clickMenu('Rename…'); await wait(400)
await setValue('form[data-sheet="rename"] input', 'c3-renamed.txt')
await js(`document.querySelector('form[data-sheet="rename"]').requestSubmit()`)
const renamed = `${projectRoot}/c3-renamed.txt`
check('(c) rename lands in the tree', await until(`document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(renamed)}) + ']')`, 10000), true)
// duplicate
await contextMenuOn(renamed); await wait(400); await clickMenu('Duplicate')
const copy = `${projectRoot}/c3-renamed copy.txt`
check('(c) duplicate lands as "name copy"', await until(`document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(copy)}) + ']')`, 10000), true)
await shot('04-renamed-duplicated')

// (d) drag the copy onto the composer card: Add to chat
notes.dropResult = await js(`
  const row = document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(copy)}) + ']')
  const card = document.querySelector('[data-composer-card]')
  if (!row || !card) return { row: !!row, card: !!card }
  const dt = new DataTransfer()
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
  const types = [...dt.types]
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
  card.dispatchEvent(over)
  card.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  await new Promise(r => setTimeout(r, 600))
  return { types, overPrevented: over.defaultPrevented, draft: card.querySelector('textarea')?.value ?? null }`)
check('(d) the row drags its path under the Files type', notes.dropResult.types?.includes('application/x-idealize-path'), true)
check('(d) the composer card takes the drop as Add to chat', notes.dropResult.draft, `${copy} `)
await shot('05-dropped-into-composer')
await setValue('[data-composer-card] textarea', '')

// (c) Move to Trash: two clicks, then gone from the tree
await contextMenuOn(copy); await wait(400)
await clickMenu('Move to Trash'); await wait(300)
notes.trashArmed = await js(`return [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim()).includes('Click again to move to Trash')`)
check('(c) Move to Trash asks for a second click', notes.trashArmed, true)
await clickMenu('Click again to move to Trash')
const gone = await until(`document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(copy)}) + ']') === null`, 15000)
notes.trashStatus = await js(`return [...document.querySelectorAll('[role="status"]')].map(e => e.textContent.trim())`)
check('(c) the second click moves the copy to the Trash', gone, true)
await contextMenuOn(renamed); await wait(400); await clickMenu('Move to Trash'); await wait(300); await clickMenu('Click again to move to Trash')
await until(`document.querySelector('[data-path=' + JSON.stringify(${JSON.stringify(renamed)}) + ']') === null`, 10000)
await shot('06-trashed')

writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => typeof notes[k] === 'string' && /^(PASS|FAIL)/.test(notes[k])).length }))
for (const f of failures) console.log('FAIL', f.name, JSON.stringify(f.actual), '!=', JSON.stringify(f.expected))
ws.close(); process.exit(failures.length === 0 ? 0 : 2)
