// Wave C2 walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy of the live
// data directory> and --remote-debugging-port=9333, then:
//   node c2-walk-proof.mjs <out-dir> [port]
// Reads routes and DOM off the window; never sends a message. Sections:
// (a) the agents route carries access, and the default-route brains with no
// stored key read no-access; (b) the media and roster routes say Motion's
// refusal is not a key matter; (c) the launcher marks a no-key brain and its
// row opens the key editor; (d) Motion's brain step offers no key action;
// (e) the Brains pane: the confined picker, the Default placeholder, the
// access mark, and no Add OpenRouter key on Motion.
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
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, m => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
  ws.send(JSON.stringify({ id: n, method, params }))
})
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
  return r.result.value
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (expr, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await js(`return Boolean(${expr})`)) return true; await wait(300) }
  return false
}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 840, deviceScaleFactor: 2, mobile: false })
const shot = async (name) => { await wait(1200); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64')) }
const failures = []; const notes = {}
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures.push({ name, actual, expected })
  notes[name] = ok ? 'PASS' : `FAIL actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
}
const clickLabel = (re) => js(`
  const el = [...document.querySelectorAll('button, a, [role="radio"], [role="tab"], [role="menuitem"]')]
    .find(e => ${re}.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))
  if (el === undefined) return false
  el.click(); return true`)
const clickSel = (sel) => js(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true`)
const railButton = (re) => js(`
  const b = [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => ${re}.test((e.getAttribute('aria-label') ?? '').trim()))
  if (!b) return false
  b.click(); return true`)
const get = (path) => js(`const r = await fetch(${JSON.stringify(path)}); return { status: r.status, body: await r.json() }`)

await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(7000)
if (await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)) {
  await clickSel('[data-onboarding-skip-all]'); await wait(2500)
}
notes.origin = await js(`return location.origin`)
await shot('00-landed')

// The walk starts from JJ's live state: the deployment default on the keyless
// DeepSeek route. A launch on a signed-in brain moves the default (upstream's
// selectModel saves the selection as the default), so a rerun resets it here.
// The scratch copy is the only thing written.
notes.resetDefault = await js(`const r = await fetch('/idealize/models/default', { method: 'POST', headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' }, body: JSON.stringify({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) }); return r.status`)
await wait(1500)

// (a) the agents route: access on every row; default-route brains read no-access
const agents = await get('/idealize/activity/agents')
notes.agents = agents.body.agents.map(a => ({ id: a.id, model: a.model, access: a.access }))
check('(a) every agent row carries access', notes.agents.every(a => a.access && typeof a.access.state === 'string'), true)
notes.defaultRouteBrains = notes.agents.filter(a => a.model?.provider === 'deepseek-official').map(a => [a.id, a.access.state, a.access.reason ?? null])
check('(a) brains on the keyless default route read no-access', notes.defaultRouteBrains.length > 0 && notes.defaultRouteBrains.every(([, state, reason]) => state === 'unavailable' && reason === 'no-access'), true)

// (b) media + roster: Motion's refusal is a catalogue gap, not a key gap
const media = await get('/idealize/brains/media')
notes.media = media.body.presets.map(p => ({ id: p.id, model: p.model, candidates: p.candidates.length, availability: p.availability }))
const motion = notes.media.find(p => p.id === 'motion')
check('(b) Motion is unavailable with keyMissing false while the OpenRouter key is stored', [motion?.availability.state, motion?.availability.reason, motion?.availability.keyMissing], ['unavailable', 'no-compatible-model', false])
check('(b) Motion\'s recovery sentence asks for no key', motion?.availability.recovery, 'No connected provider offers video generation yet.')
const sound = notes.media.find(p => p.id === 'sound')
check('(b) Sound has candidates to default to', sound !== undefined && sound.candidates > 0, true)
const roster = await get('/idealize/spaces')
notes.roster = roster.body.spaces.map(s => ({ id: s.id, models: s.models, reason: s.reason ?? null, keyMissing: s.keyMissing ?? null, brains: s.brains }))
check('(b) the roster passes keyMissing false through for Motion', notes.roster.find(s => s.id === 'motion')?.keyMissing, false)

// (c) the launcher: a no-key brain is marked and its row opens the key editor.
// JJ's Sound Stage brain chats on the keyless default route; the Gallery brain
// has a signed-in ChatGPT model and must read as ready.
await clickLabel('/^New chat in idealize$/i')
await until(`document.querySelector('[data-launcher-step="space"]')`, 20000); await wait(1500)
await clickSel('[data-launcher-step="space"] [data-space="gallery"]')
await until(`document.querySelector('[data-launcher-step="brain"]')`); await wait(1000)
notes.galleryRows = await js(`return [...document.querySelectorAll('[data-launcher-step="brain"] [data-brain]')].map(b => ({ id: b.getAttribute('data-brain'), access: b.getAttribute('data-brain-access'), text: b.textContent.trim() }))`)
check('(c) a brain on a signed-in route is unmarked and states its model', notes.galleryRows.find(r => r.id === 'gallery')?.access ?? null, null)
await shot('01-launcher-gallery')
await clickSel('[data-launcher-step="brain"] [data-launcher-back]'); await wait(800)
await clickSel('[data-launcher-step="space"] [data-space="soundstage"]')
await until(`document.querySelector('[data-launcher-step="brain"] [data-brain]')`); await wait(1000)
notes.soundRows = await js(`return [...document.querySelectorAll('[data-launcher-step="brain"] [data-brain]')].map(b => ({ id: b.getAttribute('data-brain'), access: b.getAttribute('data-brain-access'), text: b.textContent.trim() }))`)
const soundBrain = notes.soundRows.find(r => r.id === 'soundstage')
check('(c) the Sound Stage brain row is marked no-access', soundBrain?.access, 'no-access')
check('(c) the row names the route and the fix', soundBrain !== undefined && /No key for deepseek-official yet\. Add one to start here\./.test(soundBrain.text), true)
await shot('02-launcher-soundstage')
await clickSel('[data-launcher-step="brain"] [data-brain="soundstage"]')
await wait(2500)
notes.afterRowClick = await js(`return {
  chooserStillUp: document.querySelector('[data-launcher-step]') !== null,
  brainsPane: [...document.querySelectorAll('h2')].some(h => h.textContent.trim() === 'Brains') }`)
check('(c) the click starts no chat', notes.afterRowClick.chooserStillUp, true)
check('(c) the click opens the Brains pane', notes.afterRowClick.brainsPane, true)
await shot('03-after-row-click')
await clickLabel('/^Close panel$/i'); await wait(800)

// (d) Motion's brain step: the video sentence, no key action
await clickSel('[data-launcher-step="brain"] [data-launcher-back]'); await wait(800)
await clickSel('[data-launcher-step="space"] [data-space="motion"]')
await until(`document.querySelector('[data-launcher-refusal]')`)
notes.motionStep = await js(`return {
  refusal: document.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal') ?? null,
  recovery: document.querySelector('[data-launcher-recovery]')?.textContent.trim() ?? null,
  addKey: document.querySelector('[data-launcher-add-key]') !== null,
  back: document.querySelector('[data-launcher-back]') !== null }`)
check('(d) Motion states the video sentence', notes.motionStep.recovery, 'No connected provider offers a video model. Video generation waits until one does.')
check('(d) Motion offers no Add OpenRouter key action', notes.motionStep.addKey, false)
check('(d) Motion offers the way back', notes.motionStep.back, true)
await shot('04-launcher-motion')
await clickSel('[data-launcher-back]'); await wait(500)

// (e) the Brains pane: the confined picker, the Default placeholder, the
// access mark, and no Add OpenRouter key on Motion.
// (e) the Brains pane
await railButton('/^Brains$/')
await until(`document.querySelector('[data-brains-space="gallery"] [data-brain]')`, 15000)
await wait(2500)
notes.brainsPane = await js(`
  const group = id => document.querySelector('[data-brains-space="' + id + '"]')
  const rows = id => [...group(id).querySelectorAll('[role="row"]')].map(r => ({
    key: r.querySelector('span')?.textContent.trim(), brain: r.getAttribute('data-brain'), media: r.getAttribute('data-media-preset'),
    options: [...(r.querySelector('select')?.options ?? [])].map(o => o.textContent.trim()), value: r.querySelector('select')?.value ?? null,
    access: r.querySelector('[data-brain-access]')?.getAttribute('data-brain-access') ?? null,
    accessText: r.querySelector('[data-brain-access]')?.textContent.trim() ?? null,
    mediaReason: r.querySelector('[data-media-reason]')?.getAttribute('data-media-reason') ?? null,
    note: r.querySelector('[data-media-reason]')?.textContent.trim() ?? null,
    buttons: [...r.querySelectorAll('button')].map(b => b.textContent.trim()) }))
  return { gallery: rows('gallery'), soundstage: rows('soundstage'), motion: rows('motion'), chat: rows('chat') }`)
const g = notes.brainsPane.gallery
check('(e) Gallery shows its brain row and no separate Images row', [g.some(r => r.brain === 'gallery'), g.some(r => r.media === 'images')], [true, false])
const gRow = g.find(r => r.brain === 'gallery')
// The chat catalogue lists ids (gpt-5.6-sol, anthropic/claude-fable-5); the media route lists display names, none of them a chat id.
check('(e) the Gallery brain picker offers only image candidates, none from the chat catalogue', gRow !== undefined && gRow.options.length > 1 && !gRow.options.some(o => /gpt-5\.6-sol|claude-fable|deepseek-v4|^auto$/i.test(o)), true)
check('(e) the Gallery brain picker opens on Default · <first candidate>', gRow !== undefined && /^Default · /.test(gRow.options[0] ?? ''), true)
check('(e) the Gallery brain (signed-in route) carries no access mark', gRow?.access ?? null, null)
const s = notes.brainsPane.soundstage
const sRow = s.find(r => r.brain === 'soundstage')
check('(e) the Sound Stage brain is marked no-access with an Add key action', [sRow?.access, sRow?.buttons.includes('Add key')], ['no-access', true])
check('(e) Sound Stage\'s picker names the default it falls to', sRow !== undefined && sRow.value === '' && /^Default · .+/.test(sRow.options[0] ?? ''), true)
const m = notes.brainsPane.motion
check('(e) Motion states the video sentence and offers no Add OpenRouter key', [m.some(r => r.note === 'No connected provider offers a video model. Video generation waits until one does.'), m.some(r => r.buttons.includes('Add OpenRouter key'))], [true, false])
await shot('05-brains')
await clickLabel('/^Close panel$/i')

writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => typeof notes[k] === 'string' && /^(PASS|FAIL)/.test(notes[k])).length }))
for (const f of failures) console.log('FAIL', f.name, JSON.stringify(f.actual), '!=', JSON.stringify(f.expected))
ws.close()
process.exit(failures.length === 0 ? 0 : 2)
