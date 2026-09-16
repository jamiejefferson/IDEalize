// Wave-B walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9333, then: node waveb-walk-proof.mjs <out-dir>.
// Drives the shell itself, so desktopTerminals (and therefore the welcome
// row's Terminal way) is present, which a boot()-only harness cannot stub.
// Captures each surface at 1280x840. Drives an isolated --user-data-dir copy.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find(t => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, m => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
  ws.send(JSON.stringify({ id: n, method, params }))
})
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(() => { ${expr} })()`, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
  return r.result.value
}
const wait = ms => new Promise(r => setTimeout(r, ms))
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 2, mobile: false })
const shot = async (name) => { await wait(1200); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64')) }

const failures = []; const notes = {}
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures.push({ name, actual, expected })
  notes[name] = ok ? 'PASS' : `FAIL actual=${JSON.stringify(actual)}`
}
const clickLabel = (re) => js(`
  const el = [...document.querySelectorAll('button, a, [role="radio"], [role="tab"]')]
    .find(e => ${re}.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))
  if (el === undefined) return false
  el.click(); return true`)
const ringState = () => js(`
  const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
    .map(e => ({ label: (e.textContent ?? '').trim(), selected: e.getAttribute('aria-selected') === 'true' }))
  const blank = document.querySelector('[data-blank-view]')
  const c = document.querySelector('[data-composer-card], textarea, [contenteditable="true"]')
  const r = c === null ? null : c.getBoundingClientRect()
  return { tabs, blankView: blank === null ? null : blank.getAttribute('data-blank-view'),
    composerPresent: c !== null, composerVisible: r !== null && r.height > 0 && r.width > 0 }`)

// Settle, and clear any first-run card (isolated copy only).
await wait(12000)
for (let i = 0; i < 5; i += 1) {
  const dialogs = await js(`return document.querySelectorAll('[role="dialog"]').length`)
  if (dialogs === 0) break
  await clickLabel('/^(Skip for now|Continue|Close|Done)$/i'); await wait(2500)
}
await wait(6000)
notes.mode = await js(`return new URL(location.href).searchParams.get('dsh-desktop-mode')`)
check('boots in compatibility mode', notes.mode, 'compatibility')
await shot('real-00-welcome')

// (a) four ways to start
const ways = await js(`
  const seg = [...document.querySelectorAll('button, [role="radio"]')]
    .map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(Boolean)
  const has = re => seg.some(l => re.test(l))
  return { labels: seg, chat: has(/^Chat$/i), terminal: has(/^Terminal$/i), gallery: has(/^Gallery$/i), sound: has(/^Sound Stage$/i) }`)
notes.welcomeLabels = ways.labels.slice(0, 50)
check('(a) welcome offers Chat', ways.chat, true)
check('(a) welcome offers Terminal', ways.terminal, true)
check('(a) welcome offers Gallery', ways.gallery, true)
check('(a) welcome offers Sound Stage', ways.sound, true)

const newChat = async () => { await clickLabel('/^New chat$/i'); await wait(6000) }
const pick = async (label, tag) => {
  const selected = await clickLabel(`/^${label}$/i`); await wait(3000)
  const launched = await clickLabel('/^(Coding|Design|Writing|Admin)$/i'); await wait(14000)
  const s = await ringState(); await shot(tag)
  return { selected, launched, ...s }
}
notes.gallery = await pick('Gallery', 'real-01-gallery')
check('(b) Gallery lands in the gallery view', notes.gallery.blankView, 'gallery')
check('(b) Gallery keeps a visible composer', notes.gallery.composerVisible, true)
await newChat()
notes.soundstage = await pick('Sound Stage', 'real-02-soundstage')
check('(c) Sound Stage lands in the soundstage view', notes.soundstage.blankView, 'soundstage')
check('(c) Sound Stage keeps a visible composer', notes.soundstage.composerVisible, true)

// (d) Schedule: view ring yes, tool rail no
const rail = await js(`return [...document.querySelectorAll('[class*="rail"] button, [class*="Rail"] button')]
  .map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(Boolean)`)
const ring = await ringState()
notes.railLabels = rail; notes.ringTabs = ring.tabs
check('(d) Schedule absent from the tool rail', rail.some(l => /^Schedule$/i.test(l)), false)
check('(d) Schedule present in the view ring', ring.tabs.some(t => /^Schedule$/i.test(t.label)), true)
await js(`const el = [...document.querySelectorAll('[role="tablist"] [role="tab"]')]
  .find(e => /^Schedule$/i.test((e.textContent ?? '').trim())); if (el) el.click(); return true`)
await wait(9000)
notes.scheduleView = await js(`
  const t = document.body.innerText
  return { blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
    loadFailed: /Failed to (load|read)|Schedule unavailable/i.test(t), text: t.slice(0, 800) }`)
check('(d) Schedule view loads without a store error', notes.scheduleView.loadFailed, false)
await shot('real-03-schedule')

// (e) Files tabs
await clickLabel('/^Files$/i'); await wait(5000)
const files = await js(`return [...document.querySelectorAll('button, [role="tab"]')]
  .map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(Boolean)`)
notes.fileTabs = files.slice(0, 60)
check('(e) Files tab "This project"', files.some(t => /^This project$/i.test(t)), true)
check('(e) Files tab "All projects"', files.some(t => /^All projects$/i.test(t)), true)
check('(e) Files tab "Documentation"', files.some(t => /^Documentation$/i.test(t)), true)
await shot('real-04-files')
await clickLabel('/^Close panel$/i'); await wait(2000)

// (f) named chats reopen with history
const names = await js(`return [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
  .map(h => h.getAttribute('aria-label').replace('Chat actions for ', ''))`)
notes.chatNames = names
const chats = []
for (const name of names.slice(0, 6)) {
  await js(`
    const h = [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
      .find(x => x.getAttribute('aria-label') === 'Chat actions for ' + ${JSON.stringify(name)})
    if (h === undefined) return false
    const row = h.closest('div, li, a'); const target = row?.querySelector('[class*="title"]') ?? row
    if (!target) return false
    target.click(); return true`)
  await wait(6000)
  const r = await js(`
    const t = document.body.innerText
    return { loadError: /Failed to load history/.test(t) ? t.split('Failed to load history')[1].slice(0,200).trim() : null,
      flowNodes: document.querySelectorAll('[data-chat-flow] > *').length, chars: t.length }`)
  chats.push({ name, ...r })
}
notes.chats = chats
check('(f) named chats were opened', chats.length > 0, true)
for (const c of chats) check(`(f) chat "${c.name}" reopens without a history load error`, c.loadError, null)
await shot('real-05-chat-history')

const report = { ok: failures.length === 0, failures, notes }
writeFileSync(join(OUT, 'real-walk.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
