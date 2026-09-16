// its CDP port. Launch the packaged binary with --user-data-dir=<scratch copy>
// and --remote-debugging-port=9333, then: node landing-walk-proof.mjs <out-dir>.
// Drives the shell itself (so desktopTerminals is present and a Terminal chat
// really spawns a shell) against an isolated copy of the app's data directory.
// Never sends a message: every state is read off the DOM after a click.
// Captures each surface at 1280x840.
// Sections (i) and (j) prove the two S11 fixes; (m), (n) and (o) prove
// landing 8: one Services list that never asks for a web address, the Video
// space's new grid, and the Sound Stage showing this chat rather than the
// project. (p) proves landing 9 (JJ, 7 Sep): sorted pickers, one coordinator
// row, a sign-in named where a sign-in is what a route waits on, a generating
// brain's own chat model, and a welcome card that follows the Brains pane.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const OUT = process.argv[2]
const PORT = process.argv[3] ?? '9333'
mkdirSync(OUT, { recursive: true })
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
// A1 adds the app-lifetime Askbar window as a second page target; the walk drives the main window.
const page = list.find(t => t.type === 'page' && !t.url.includes('dsh-desktop-mode=askbar'))
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
// Poll a DOM predicate instead of guessing a delay; returns whether it became true.
const until = async (expr, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await js(`return Boolean(${expr})`)) return true; await wait(300) }
  return false
}
// Poll an expression until it yields a value other than null; returns that value or null.
const untilValue = async (expr, timeout = 20000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await js(`return (${expr}) ?? null`); if (value !== null) return value; await wait(300) }
  return null
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
const text = (sel) => js(`return document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? null`)
const composer = () => js(`
  const c = document.querySelector('[data-composer-card], textarea, [contenteditable="true"]')
  const r = c === null ? null : c.getBoundingClientRect()
  return { present: c !== null, visible: r !== null && r.height > 0 && r.width > 0 }`)
const chrome = () => js(`
  const rail = document.querySelector('nav[aria-label="Tool rail"]')
  const outsideRail = el => rail === null || !rail.contains(el)
  const panel = document.querySelector('[data-bar-panel], [class*="DrawerPanel"], [class*="drawer"]')
  const inChat = el => outsideRail(el) && (panel === null || !panel.contains(el)) && el.closest('[data-launcher-step]') === null && el.closest('[role="menu"]') === null && el.closest('[data-brain-switcher]') === null
  const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')].filter(inChat).map(e => (e.textContent ?? '').trim())
  const pills = [...document.querySelectorAll('button')].filter(inChat)
    .map(e => (e.textContent ?? '').trim()).filter(l => /^(Coding|Design|Writing|Admin|Free)$/.test(l))
  return { tabs, pills }`)
const spaceStep = () => js(`
  const step = document.querySelector('[data-launcher-step="space"]')
  if (step === null) return null
  return [...step.querySelectorAll('[data-space]')].map(e => ({ space: e.getAttribute('data-space'), brains: e.getAttribute('data-brain-count'), disabled: e.disabled, label: e.querySelector('[class*="tileName"]')?.textContent?.trim() ?? null }))`)
const brainStep = () => js(`
  const step = document.querySelector('[data-launcher-step="brain"]')
  if (step === null) return null
  return { space: step.getAttribute('data-space'), summary: step.querySelector('[data-brain-summary]')?.textContent?.trim() ?? null,
    brains: [...step.querySelectorAll('[data-brain]')].map(e => e.getAttribute('data-brain')),
    refusal: step.querySelector('[data-launcher-refusal]')?.getAttribute('data-launcher-refusal') ?? null,
    recovery: step.querySelector('[data-launcher-recovery]')?.textContent?.trim() ?? null,
    pickAnother: [...step.querySelectorAll('button')].some(b => /Pick another space/.test(b.textContent ?? '')) }`)
// The brain switcher and the access chip moved into the composer's three-dot
// panel (landing 19, 9 Sep 2026), so the switcher is in the DOM only while
// that panel is open. The trigger is what says a composer has landed; every
// read of the switcher opens the panel and closes it again.
const OVERFLOW = '[data-composer-overflow-trigger]'
const overflowOpen = () => js(`return document.querySelector('[data-composer-overflow-panel]') !== null`)
const openOverflow = async () => {
  if (await overflowOpen()) return true
  const clicked = await js(`const el = document.querySelector('${OVERFLOW}'); if (el === null) return false; el.click(); return true`)
  if (!clicked) return false
  return await until(`document.querySelector('[data-composer-overflow-panel]')`, 8000)
}
const closeOverflow = async () => {
  if (!await overflowOpen()) return
  await js(`document.querySelector('${OVERFLOW}')?.click(); return true`)
  await wait(400)
}
// Readiness: the trigger says a composer landed, the switcher inside the panel
// says the roster placed this chat on a brain. The old walk polled the switcher
// on the row for exactly that second fact, so the poll opens the panel once and
// watches inside it rather than settling for the trigger.
const untilBrainReady = async (timeout = 30000) => {
  if (!await until(`document.querySelector('${OVERFLOW}')`, timeout)) return false
  if (!await openOverflow()) return false
  const ready = await until(`document.querySelector('[data-brain-switcher]')`, timeout)
  await closeOverflow()
  return ready
}
const switcher = async () => {
  if (!await openOverflow()) return null
  if (!await until(`document.querySelector('[data-brain-switcher]')`, 15000)) { await closeOverflow(); return null }
  // The switcher renders from the store the previous mount left and refreshes
  // when the read its own effect fires answers, so a value read the instant the
  // panel opens is the last chat's. Settle on two agreeing reads a beat apart.
  let value = null
  const read = () => js(`
    const s = document.querySelector('[data-brain-switcher]')
    if (s === null) return null
    return { space: s.getAttribute('data-space'), current: s.getAttribute('data-brain-current'), name: s.textContent.trim(), disabled: s.disabled }`)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const first = await read()
    await wait(700)
    const second = await read()
    if (first !== null && JSON.stringify(first) === JSON.stringify(second)) { value = second; break }
    value = second
  }
  await closeOverflow()
  return value
}
// The chat on screen, by the id the client runtime holds for it. A blank chat
// writes no session directory until it is sent to, so the rendered tree is the
// only place section (j) can read which chat it is looking at.
const sessionId = () => js(`
  const el = document.querySelector('[data-composer-overflow-trigger]') ?? document.querySelector('[data-chat-flow]') ?? document.querySelector('[data-composer-card]') ?? document.body
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  if (key === undefined) return null
  let fiber = el[key]
  for (let depth = 0; fiber !== null && fiber !== undefined && depth < 60; depth += 1) {
    const props = fiber.memoizedProps
    if (props !== null && typeof props === 'object' && typeof props.sessionId === 'string') return props.sessionId
    fiber = fiber.return
  }
  return null`)
const sidebarRow = (name) => js(`
  const h = [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
    .find(x => x.getAttribute('aria-label') === 'Chat actions for ' + ${JSON.stringify(name)})
  if (h === undefined) return false
  const row = h.closest('div, li, a'); const target = row?.querySelector('[class*="title"]') ?? row
  if (!target) return false
  target.click(); return true`)

// Settle (isolated copy only).
await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(7000)
// The first-run onboarding wizard (new to the bundle this round) gates the app
// until finished or skipped; record that it appeared, then skip it.
notes.onboardingWizard = await js(`
  const skip = document.querySelector('[data-onboarding-skip-all]')
  return skip === null ? null : { heading: document.querySelector('h1, h2')?.textContent?.trim() ?? null, probing: /Checking the folder/.test(document.body.innerText) }`)
if (notes.onboardingWizard !== null) {
  await shot('00-onboarding-wizard')
  await clickSel('[data-onboarding-skip-all]')
  await wait(2500)
  for (let i = 0; i < 3 && await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`); i += 1) {
    await clickLabel('/^(Continue|Done|Finish|Close)$/i'); await wait(2000)
  }
}
notes.mode = await js(`return new URL(location.href).searchParams.get('dsh-desktop-mode')`)
check('boots in compatibility mode', notes.mode, 'compatibility')

const newChat = async () => {
  await clickSel('button[class*="newChat"], button[class*="newSession"]')
  await until(`document.querySelector('[data-launcher-step="space"]')`, 20000)
  await wait(1500)
}
if ((await spaceStep()) === null) await newChat()

// (a) the space step: five live tiles. The chooser mounts before its roster
// read answers on a cold boot, so wait for the tiles, not the step.
await until(`document.querySelectorAll('[data-launcher-step="space"] [data-space]').length >= 5`, 20000)
notes.spaceStep = await spaceStep()
check('(a) space step shows five tiles', notes.spaceStep?.map(t => t.space), ['chat', 'terminal', 'gallery', 'soundstage', 'motion'])
check('(a) no tile is disabled', notes.spaceStep?.every(t => t.disabled === false), true)
// The 1 Sep rename: ids stay gallery/soundstage/motion, the labels say what you get.
check('(a) the tiles read Chat, Terminal, Images, Sounds, Video', notes.spaceStep?.map(t => t.label), ['Chat', 'Terminal', 'Images', 'Sounds', 'Video'])
notes.stepMark = await text('[data-launcher-step="space"] [class*="stepMark"]')
check('(a) step mark reads Step 1 of 2', notes.stepMark, 'Step 1 of 2')
await shot('01-space-step')

// (p) Landing 9, JJ 7 Sep. The scratch copy is JJ's live data: the default
// model sits on the ChatGPT route with no sign-in, so every generating brain
// waits on it. The pane must say so and offer the sign-in, list its pickers
// alphabetically, carry one section for the coordinator, and let each
// generating brain choose its own chat model — which is what puts the three
// spaces back in use for the sections that follow.
const openBrains = async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await js(`[...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Brains$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))?.click(); return true`)
    if (await until(`document.querySelector('[data-brains-space="chat"] [data-brain] [data-brain-model]')`, 20000)) return true
  }
  return false
}
notes.brainsOpened = await openBrains()
await wait(1200)
notes.brainsTables = await js(`return [...document.querySelectorAll('[role="table"]')].map(e => e.getAttribute('aria-label'))`)
check('(p) Agent roles is the one section for the coordinator: no Project leadership table', [notes.brainsTables.includes('Agent roles'), notes.brainsTables.includes('Project leadership')], [true, false])
const sortedBy = (list) => JSON.stringify(list) === JSON.stringify([...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })))
// JJ, 7 Sep: no drop-down on the rows; the model reads as text and the Edit
// sheet is the one place it is chosen, so the sort claim is read off the sheet.
notes.rowsAsText = await js(`
  const rows = [...document.querySelectorAll('[data-brains-space] [data-brain]')]
  const outsideTerminal = rows.filter(r => r.closest('[data-brains-space="terminal"]') === null)
  return { rows: rows.length, outsideTerminal: outsideTerminal.length, selects: outsideTerminal.filter(r => r.querySelector('select') !== null).length,
    text: outsideTerminal.filter(r => r.querySelector('[data-brain-model]') !== null).length }`)
// A Terminal row carries the CLI select and no model text: the CLI decides
// what the shell types, and the model belongs to that CLI's own login.
check('(p) brain rows state the model as text and carry no picker outside Terminal', [notes.rowsAsText.outsideTerminal > 0, notes.rowsAsText.selects, notes.rowsAsText.text === notes.rowsAsText.outsideTerminal], [true, 0, true])
await js(`[...document.querySelectorAll('[data-brains-space="chat"] [data-brain] button')].find(b => /^Edit$/.test(b.textContent.trim()))?.click(); return true`)
await until(`document.querySelector('select[data-brains-model]')`, 15000)
await wait(600)
notes.pickerOrder = await js(`
  const select = document.querySelector('select[data-brains-model]')
  const groups = [...(select?.querySelectorAll('optgroup') ?? [])]
  return { groups: groups.map(g => g.label.replace(/ · .*$/, '')), models: groups.map(g => [...g.querySelectorAll('option')].map(o => o.textContent.trim())) }`)
await js(`[...document.querySelectorAll('form button')].find(b => /^Cancel$/.test(b.textContent.trim()))?.click(); return true`)
await until(`document.querySelector('select[data-brains-model]') === null`, 10000)
await wait(600)
check('(p) picker lists providers alphabetically', sortedBy(notes.pickerOrder.groups), true)
check('(p) picker lists each provider\'s models alphabetically', notes.pickerOrder.models.every(sortedBy), true)
check('(p) picker offers more than one provider, so the order is a real claim', notes.pickerOrder.groups.length > 1, true)
notes.galleryAccess = await js(`
  const note = document.querySelector('[data-brains-space="gallery"] [data-brain-access]')
  return note === null ? null : { reason: note.getAttribute('data-brain-access'), text: note.textContent.trim(),
    link: note.querySelector('a')?.getAttribute('href') ?? null, addKey: [...note.querySelectorAll('button')].some(b => /Add key/.test(b.textContent)) }`)
// The claim needs a brain that waits on an unsigned route. JJ's data carried
// one on 7 Sep (landing 9); once every brain reaches a model the pane shows
// no access note, and the claim has nothing to read.
if (notes.galleryAccess === null) {
  notes.unsignedRouteClaim = 'no brain waits on a route in this data; the sign-in note is not on screen to check'
} else {
  check('(p) a brain on the unsigned ChatGPT route names the sign-in, not a key', [notes.galleryAccess.reason, /^Not signed in to /.test(notes.galleryAccess.text), notes.galleryAccess.link, notes.galleryAccess.addKey], ['no-sign-in', true, '/idealize/signin', false])
  check('(p) the sign-in note names the route by its display name, not its id', /openai-codex/.test(notes.galleryAccess.text), false)
}
await shot('02p-brains-sign-in-note')
// Each generating brain's sheet asks its chat model as well as its generation
// model. Moving the three onto the signed-in OpenRouter route is what JJ will
// do, and what lets the Images, Sounds and Video sections below land.
notes.moved = {}
for (const space of ['gallery', 'soundstage', 'motion']) {
  await js(`[...document.querySelectorAll('[data-brains-space="${space}"] [data-brain] button')].find(b => /^Edit$/.test(b.textContent.trim()))?.click(); return true`)
  const opened = await until(`document.querySelector('[data-brains-chat-model]')`, 15000)
  await wait(600)
  const sheet = await js(`
    const fields = [...document.querySelectorAll('[data-brains-field]')].map(e => e.getAttribute('data-brains-field'))
    const chat = document.querySelector('[data-brains-chat-model]')
    const openrouter = [...(chat?.querySelectorAll('option') ?? [])].map(o => o.value).find(v => /^openrouter /.test(v)) ?? null
    return { fields, openrouter }`)
  if (space === 'motion') await shot('02q-video-brain-two-models')
  await js(`
    const set = (el, value) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      desc.set.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const chat = document.querySelector('[data-brains-chat-model]')
    if (chat) set(chat, ${JSON.stringify(String(sheet.openrouter ?? ''))})
    return true`)
  await wait(400)
  await js(`[...document.querySelectorAll('form button[type="submit"]')].pop()?.click(); return true`)
  const closed = await until(`document.querySelector('[data-brains-chat-model]') === null`, 15000)
  await wait(2500)
  const access = await js(`return document.querySelector('[data-brains-space="${space}"] [data-brain-access]')?.getAttribute('data-brain-access') ?? null`)
  notes.moved[space] = { opened, fields: sheet.fields, openrouter: sheet.openrouter, closed, access }
}
check('(p) a generating brain\'s sheet asks the generation model and the chat model', notes.moved.motion.fields, ['spaces', 'name', 'model', 'chat-model', 'instructions'])
check('(p) the chat model field offers the signed-in OpenRouter route', ['gallery', 'soundstage', 'motion'].every(s => typeof notes.moved[s].openrouter === 'string'), true)
check('(p) after choosing a reachable chat model no generating brain carries a refusal', ['gallery', 'soundstage', 'motion'].map(s => notes.moved[s].access), [null, null, null])
await shot('02r-generating-brains-reachable')
await clickLabel('/^Close panel$/i'); await wait(1500)

// (b) a brain click lands in the space with a live composer (Chat, default brain)
// The copied data may reopen the person's last chat instead of the launcher.
if (!await js(`return document.querySelector('[data-launcher-step="space"]') !== null`)) {
  await clickLabel('/^New chat$/i')
  await until(`document.querySelector('[data-launcher-step="space"]')`)
}
await clickSel('[data-launcher-step="space"] [data-space="chat"]')
await until(`document.querySelector('[data-launcher-step="brain"]')`)
notes.chatBrainStep = await brainStep()
check('(b) Chat brain step lists five brains', notes.chatBrainStep?.brains, ['coding', 'design', 'writing', 'admin', 'free'])
await shot('02-chat-brain-step')
await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
await untilBrainReady(30000)
await wait(2000)
notes.chatLanding = { composer: await composer(), switcher: await switcher(), blankView: await js(`return document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null`), launcherGone: await js(`return document.querySelector('[data-launcher-step]') === null`) }
check('(b) brain click lands with a visible composer', notes.chatLanding.composer.visible, true)
check('(b) the launcher card is gone after the click', notes.chatLanding.launcherGone, true)
// JJ, 8 Sep: "plan mode only relevant in chat and terminal"; the icon's caption names the mode first.
notes.chatLanding.plan = await js(`const b = document.querySelector('[data-plan-toggle]'); return b ? { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') } : null`)
check('(b) the Chat composer carries the plan icon, captioned with the mode before the effect', [notes.chatLanding.plan !== null, /^Plan mode (on|off)\. Click to turn (off|on)\.$/.test(notes.chatLanding.plan?.label ?? '')], [true, true])
await wait(4000)
notes.chatLanding.switcherSettled = await switcher()
check('(b) the composer switcher names the chosen brain in Chat', [notes.chatLanding.switcherSettled?.space, notes.chatLanding.switcherSettled?.current], ['chat', 'coding'])
// JJ, 8 Sep: "the cursor is straying as i write". Record the composer's typing
// layer against its glyph layers: the caret lives in the textarea, the glyphs
// in the backdrop, so any metric they do not share moves the caret off the text.
notes.chatLanding.composerLayers = await js(`
  const ta = document.querySelector('[data-composer-card] textarea')
  if (!ta) return null
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  ta.focus(); setter.call(ta, 'dfgdfg dfgdfg dfg the quick brown fox jumps over the lazy dog'); ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  const pick = e => { const s = getComputedStyle(e); return { cls: (e.className || '').toString().slice(0, 40), font: s.fontFamily.slice(0, 60), size: s.fontSize, weight: s.fontWeight, letterSpacing: s.letterSpacing, wordSpacing: s.wordSpacing, kerning: s.fontKerning, features: s.fontFeatureSettings } }
  const c = document.createElement('canvas').getContext('2d')
  const width = e => { const s = getComputedStyle(e); c.font = s.font; c.letterSpacing = s.letterSpacing; c.wordSpacing = s.wordSpacing; return Math.round(c.measureText(ta.value).width * 10) / 10 }
  const layers = [...ta.parentElement.children].filter(e => e !== ta)
  const out = { textarea: { ...pick(ta), textWidth: width(ta) }, layers: layers.map(e => ({ ...pick(e), textWidth: width(e) })) }
  setter.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true }))
  return out`)
check('(b) the composer\'s typing layer and its glyph layers share one letter-spacing, so the caret stays on the text', [notes.chatLanding.composerLayers?.textarea.letterSpacing, ...(notes.chatLanding.composerLayers?.layers ?? []).map(l => l.letterSpacing)].every((v, _, all) => v === all[0]), true)
await shot('03-chat-landing')

// (f) no tab row, no pill row, in a started chat
notes.chromeChat = await chrome()
check('(f) no tab row in a Chat chat', notes.chromeChat.tabs, [])
check('(f) no pill row in a Chat chat', notes.chromeChat.pills, [])

// (d) brain switcher menu in Chat
await openOverflow()
await clickSel('[data-brain-switcher]')
await until(`document.querySelector('[role="menu"]')`, 8000)
notes.chatMenu = await js(`return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(e => e.textContent.trim())`)
check('(d) the Chat switcher menu offers brains', notes.chatMenu.length >= 5, true)
check('(d) the Chat switcher menu says nothing about restarts', notes.chatMenu.some(l => /restart/i.test(l)), false)
await shot('04-chat-brain-menu')
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`)
await wait(800)
if (await js(`return document.querySelector('[role="menu"]') !== null`)) await clickSel('[data-brain-switcher]')
await closeOverflow()
await wait(800)

// (b2) Gallery: a brain click lands in the gallery view. Each launched-but-
// unsent chat is reused by that project's New chat without a chooser (S8
// note 1), so every further pick starts from a different project's blank chat.
const freshChooser = async (project, tag) => {
  // A card left on step 2 by an earlier section stays there: New chat on the
  // same blank chat re-opens the card where it was, so step back first.
  if (await js(`return document.querySelector('[data-launcher-step="brain"]') !== null`)) {
    await clickSel('[data-launcher-back]')
    await until(`document.querySelector('[data-launcher-step="space"]')`, 8000)
  }
  // The per-project row action renders only while the row shows it; when it is
  // absent, focus the project and use the sidebar's New chat button (selected
  // by class: a blank chat row also reads "New chat", so no text match).
  let ok = false
  if (await clickLabel(`/^New chat in ${project}$/i`)) ok = await until(`document.querySelector('[data-launcher-step="space"]')`, 8000)
  if (!ok) {
    await clickLabel(`/^${project}$/i`)
    await wait(1200)
    await clickSel('button[class*="newChat"], button[class*="newSession"]')
    ok = await until(`document.querySelector('[data-launcher-step="space"]')`, 20000)
  }
  if (!ok) await shot(`fail-${tag}-no-chooser`)
  await wait(1500)
  return ok
}
notes.chooserForGallery = await freshChooser('idealize', 'gallery')
// A tile click can race the card slide-in (the S7 lesson): one retry, as Motion has.
// A tile click ends one of two ways (JJ, 7 Sep): step 2 when the space has
// several brains or its one brain cannot start, or the chat itself when the
// space has one reachable brain. Returns 'step', 'landed', or false.
const enterSpace = async (space) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await clickSel(`[data-launcher-step="space"] [data-space="${space}"]`)
    const outcome = await untilValue(`document.querySelector('[data-launcher-step="brain"]') ? 'step' : (document.querySelector('[data-launcher-step="space"]') === null ? 'landed' : null)`, 8000)
    if (outcome !== null) return outcome
  }
  return false
}
// Land in a space: through step 2's first brain row when the step shows, or
// straight from the tile. Returns how it entered, the brain, and whether the
// space's view arrived.
const landIn = async (space, viewSel) => {
  const entry = await enterSpace(space)
  let brain = null
  if (entry === 'step') {
    brain = (await brainStep())?.brains?.[0] ?? null
    if (brain === null) return { entry, brain, landed: false }
    await clickSel(`[data-launcher-step="brain"] [data-brain="${brain}"]`)
    // A brain click can race the step's own mount under load: one retry.
    if (!await until(`document.querySelector('${viewSel}')`, 15000)) await clickSel(`[data-launcher-step="brain"] [data-brain="${brain}"]`)
  }
  const landed = await until(`document.querySelector('${viewSel}')`, 30000)
  await wait(2000)
  if (brain === null) brain = (await switcher())?.current ?? null
  return { entry, brain, landed }
}
const pickTile = async (space) => (await enterSpace(space)) !== false
notes.galleryEntry = await landIn('gallery', '[data-blank-view="gallery"]')
const galleryBrain = notes.galleryEntry.brain ?? undefined
if (notes.galleryEntry.landed) {
  notes.galleryLanding = { composer: await composer(), blankView: await js(`return document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null`), switcher: await switcher() }
  check('(b) Gallery lands in the gallery view', notes.galleryLanding.blankView, 'gallery')
  check('(b) Gallery keeps a visible composer', notes.galleryLanding.composer.visible, true)
  const galleryTile = notes.spaceStep?.find(t => t.space === 'gallery')
  if (galleryTile?.brains === '1') check('(b) a space with one reachable brain lands from the tile, with no brain step', notes.galleryEntry.entry, 'landed')
  await shot('05-gallery-landing')
} else {
  notes.galleryLanding = 'no gallery brain offered'
  check('(b) Gallery offers a brain', false, true)
}

// (c) Motion has a route (landing 7: fal.ai serves text-to-video), so step 2
// no longer dead-ends: with no Video brain yet it offers to add one and says
// models are ready. The host's New chat reuses a launched-but-unsent Gallery
// chat with no chooser (S8 note), so start from another project.
notes.chooserForMotion = await freshChooser('My first project', 'motion')
notes.motionEntry = await enterSpace('motion')
if (notes.motionEntry === 'landed') {
  // JJ's data carries one Video brain and (p) put it on a reachable route, so
  // the tile lands in the Video grid with no step 2 (JJ, 7 Sep).
  await until(`document.querySelector('[data-blank-view="motion"]')`, 30000)
  await wait(1500)
  notes.motion = { blankView: await js(`return document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null`) }
  check('(c) Motion with one reachable brain lands in the Video grid from the tile', notes.motion.blankView, 'motion')
  await shot('06-motion-has-a-route')
} else {
  if (notes.motionEntry !== 'step') await shot('fail-motion-no-brain-step')
  await until(`/Models that can serve Video are ready/.test(document.querySelector('[data-launcher-step="brain"]')?.textContent ?? '')`, 15000)
  await wait(1500)
  notes.motion = await brainStep()
  notes.motionAdd = await js(`
    const step = document.querySelector('[data-launcher-step="brain"]')
    const add = [...(step?.querySelectorAll('button') ?? [])].find(b => /Add a brain for Video/.test(b.textContent ?? ''))
    return { add: add !== undefined, text: step?.textContent ?? '' }`)
  check('(c) Motion step 2 is no longer a dead end: no refusal, no Pick another space', [notes.motion?.refusal, notes.motion?.pickAnother], [null, false])
  // On data without a Video brain the offer to add one stands.
  check('(c) Motion step 2 lists a Video brain, or offers to add one and says models are ready', (notes.motion?.brains?.length ?? 0) > 0 || (notes.motionAdd?.add === true && /Models that can serve Video are ready/.test(notes.motionAdd?.text ?? '')), true)
  await shot('06-motion-has-a-route')
  await clickSel('[data-launcher-back]')
  await until(`document.querySelector('[data-launcher-step="space"]')`)
}

// (d) Terminal: the switcher and the restart warning
if (notes.motionEntry === 'landed') notes.chooserForTerminal = await freshChooser('idealize', 'terminal')
await clickSel('[data-launcher-step="space"] [data-space="terminal"]')
await until(`document.querySelector('[data-launcher-step="brain"]')`)
notes.terminalBrainStep = await brainStep()
// JJ, 7 Sep: Free left Terminal ("there's no free one"): four brains.
check('(d) Terminal brain step lists four brains, Free absent', notes.terminalBrainStep?.brains, ['coding', 'design', 'writing', 'admin'])
// Wave D item 7: in Terminal every row names the CLI it launches (the launches
// table's catalogue label), never a chat model or a missing model key.
await until(`document.querySelector('[data-launcher-step="brain"] [data-brain][data-brain-cli]')`, 15000)
notes.terminalBrainClis = await js(`return [...document.querySelectorAll('[data-launcher-step="brain"] [data-brain]')].map(e => ({ brain: e.getAttribute('data-brain'), cli: e.getAttribute('data-brain-cli'), access: e.getAttribute('data-brain-access'), text: e.textContent }))`)
check('(d) every Terminal brain row names a CLI and none is key-gated', notes.terminalBrainClis.every(r => typeof r.cli === 'string' && r.cli.length > 0 && r.access === null), true)
check('(d) no Terminal brain row prints a chat model route', notes.terminalBrainClis.some(r => /openrouter|openai-codex|deepseek-official|No key for/i.test(r.text)), false)
await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
let terminalSwitcher = await untilBrainReady(20000)
if (!terminalSwitcher) {
  await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
  terminalSwitcher = await untilBrainReady(45000)
}
await wait(3000)
notes.terminalLanding = { switcher: await switcher(), composer: await composer(), terminalCanvas: await js(`return document.querySelectorAll('.xterm, [class*="xterm"], canvas').length`) }
check('(d) Terminal chat shows the brain switcher', [terminalSwitcher, notes.terminalLanding.switcher !== null], [true, true])
await shot('07-terminal-landing')
if (terminalSwitcher) {
  await openOverflow()
  await clickSel('[data-brain-switcher]')
  await until(`document.querySelector('[role="menu"]')`, 8000)
  notes.terminalMenu = await js(`return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(e => ({ text: e.textContent.trim(), restarts: /restarts the shell/.test(e.textContent) }))`)
  await shot('08-terminal-brain-menu')
  // C6 moved CLI choice to per-brain Brains-pane settings; every brain in this
  // data launches the same CLI, so no menu row warns "restarts the shell" and
  // the restart dialog cannot fire from it. The CLI switch and its dialog are
  // covered by ui-terminal's specs and the C6 packaged walk (02-terminal-clis.png).
  check('(d) the Terminal switcher menu lists the four brains', [notes.terminalMenu.length >= 4, notes.terminalMenu.some(m => /^Free$/i.test(m.text))], [true, false])
  await js(`document.body.click(); return true`)
  await wait(800)
  await closeOverflow()
}
notes.chromeTerminal = await chrome()
check('(f) no tab row in a Terminal chat', notes.chromeTerminal.tabs, [])
check('(f) no pill row in a Terminal chat', notes.chromeTerminal.pills, [])

// (d2) Wave D item 6: a Terminal chat is a started chat — its sidebar row is
// listed (not only while current) and carries the row menu. The row is found
// by the chat-actions label on the current (terminal) chat.
notes.terminalRow = await js(`
  const rows = [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
  return rows.map(h => ({ label: h.getAttribute('aria-label'), space: h.closest('li, div, a')?.querySelector('[data-space]')?.getAttribute('data-space') ?? null }))`)
check('(d) the Terminal chat has a row with the actions menu', notes.terminalRow.some(r => r.space === 'terminal'), true)
// Wave D item 3: the sidebar header offers the collapse-to-Askbar button (the
// bar itself is hidden until pressed; the shell proof covers the transform).
notes.collapseButton = await js(`return document.querySelector('button[aria-label="Collapse to the Askbar"]') !== null`)
check('(d) the sidebar header offers Collapse to the Askbar', notes.collapseButton, true)

// (e) Trajectory and Schedule as rail panes
notes.rail = await js(`return [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(Boolean)`)
check('(e) Trajectory sits in the tool rail', notes.rail.some(l => /^Trajectory$/i.test(l)), true)
check('(e) Schedule sits in the tool rail', notes.rail.some(l => /^Schedule$/i.test(l)), true)
await js(`[...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Trajectory$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))?.click(); return true`)
await wait(4000)
notes.trajectoryPane = await js(`
  const b = [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Trajectory$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))
  const t = document.body.innerText
  return { pressed: b?.getAttribute('aria-pressed') ?? b?.getAttribute('aria-selected') ?? null, error: /Failed to (load|read)/i.test(t), mentionsTrajectory: /Trajectory/i.test(t) }`)
check('(e) Trajectory pane opens without a load error', notes.trajectoryPane.error, false)
await shot('10-trajectory-pane')
await js(`[...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Schedule$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))?.click(); return true`)
await wait(5000)
notes.schedulePane = await js(`
  const t = document.body.innerText
  return { error: /Failed to (load|read)|Schedule unavailable/i.test(t), grains: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(l => /^(Day|Week|Month)$/.test(l)),
    weekdays: /Mon|Tue|Wed|Thu|Fri/.test(t) }`)
check('(e) Schedule pane opens without a store error', notes.schedulePane.error, false)
// C5 (feedback wave) rebuilt the pane with a Day lane behind a Day | Week switcher; Month arrived 4 Sep (a Month that picks a day).
check('(e) Schedule offers Day, Week and Month grains', [...new Set(notes.schedulePane.grains)].sort(), ['Day', 'Month', 'Week'])
await shot('11-schedule-pane')
await clickLabel('/^Close panel$/i'); await wait(1500)

// (g) sidebar space icons on chat rows
notes.sidebarGlyphs = await js(`
  const rows = [...document.querySelectorAll('[aria-label^="Chat actions for "]')]
  const out = []
  for (const h of rows) {
    const row = h.closest('li, div, a')
    const g = row?.querySelector('[data-space]')
    out.push({ chat: h.getAttribute('aria-label').replace('Chat actions for ', '').slice(0, 40), space: g?.getAttribute('data-space') ?? null, label: g?.getAttribute('aria-label') ?? null })
  }
  return out`)
check('(g) every sidebar chat row carries a space glyph', notes.sidebarGlyphs.length > 0 && notes.sidebarGlyphs.every(r => r.space !== null), true)
notes.sidebarSpaces = [...new Set(notes.sidebarGlyphs.map(r => r.space))]
await shot('12-sidebar-space-icons')

// (h) existing named chats reopen with their history
const names = [...new Set(notes.sidebarGlyphs.map(r => r.chat))]
const chats = []
for (const name of names.slice(0, 8)) {
  const clicked = await sidebarRow(name)
  if (!clicked) continue
  await wait(5000)
  const r = await js(`
    const t = document.body.innerText
    return { loadError: /Failed to load history/.test(t) ? t.split('Failed to load history')[1].slice(0,200).trim() : null,
      flowNodes: document.querySelectorAll('[data-chat-flow] > *').length, switcher: document.querySelector('[data-composer-overflow-trigger]')?.getAttribute('data-space') ?? null,
      composer: document.querySelector('[data-composer-card], textarea, [contenteditable="true"]') !== null,
      launcher: document.querySelector('[data-launcher-step], [data-blank-view]') !== null }`)
  chats.push({ name, ...r })
}
notes.chats = chats
check('(h) named chats were opened', chats.length > 0, true)
for (const c of chats) check(`(h) chat "${c.name}" reopens without a history load error`, c.loadError, null)
// A blank chat (launched, never sent) legitimately renders no transcript: it
// reopens onto a live composer (or its launcher) with no error banner and no
// flow nodes. A chat whose stored history FAILED to render shows the error
// banner, which loadError catches per row above. The stored-history
// expectation only has a subject when a non-blank chat is listed — the
// sidebar lists the newest rows, and live data changes between landings.
const withHistory = chats.filter(c => c.flowNodes > 0)
if (withHistory.length === 0) {
  notes.historySkipped = 'every listed sidebar chat is blank in this data (the sidebar lists the newest rows; older stored transcripts are not listed), so the stored-history expectation has no subject'
  check('(h) every listed blank chat reopens clean: a live surface, no error', chats.every(c => c.loadError === null && (c.composer || c.launcher)), true)
} else {
  check('(h) at least one reopened chat renders stored history', withHistory.some(c => c.flowNodes > 0), true)
}
await shot('13-chat-history')

// (i) S11 fix 1: the composer brain switcher never renders a raw id. Every id
// in the space table and the brain roster, lowercase, is a label the trigger
// must never show; it renders nothing rather than an id it cannot name.
const RAW_ID = /^(chat|terminal|gallery|soundstage|motion|coding|design|writing|admin|free)$/
const label = (s) => (s?.name ?? '').trim()

// (i.1) a fresh Gallery launch, read the instant the switcher mounts.
notes.chooserForFix1 = await freshChooser('idealize', 'fix1')
notes.fix1Entry = await enterSpace('gallery')
if (notes.fix1Entry === 'step') {
  const fix1Brain = (await brainStep())?.brains[0]
  await clickSel(`[data-launcher-step="brain"] [data-brain="${fix1Brain}"]`)
}
await untilBrainReady(30000)
notes.fix1Immediate = await switcher()
check('(i) a fresh Gallery launch shows no raw id the instant it lands', RAW_ID.test(label(notes.fix1Immediate)), false)
await wait(4000)
notes.fix1Settled = await switcher()
check('(i) a fresh Gallery launch names its brain once settled', [notes.fix1Settled?.space, typeof notes.fix1Settled?.current === 'string' && notes.fix1Settled.current !== ''], ['gallery', true])
check('(i) the settled Gallery label is not a raw id', RAW_ID.test(label(notes.fix1Settled)), false)
await shot('14-fix1-gallery-launch')

// (i.2) the chat that carried the defect: a blank chat with a recorded Gallery
// space, then Chat -> Coding. Last round the trigger read "gallery".
const recorded = notes.sidebarGlyphs.find(r => r.space === 'gallery')?.chat ?? '_Obsidian Vaults'
notes.fix1RecordedChat = recorded
notes.fix1RecordedOpened = await sidebarRow(recorded)
await wait(5000)
notes.fix1RecordedBefore = { launcher: await js(`return document.querySelector('[data-launcher-step]')?.getAttribute('data-launcher-step') ?? null`), switcher: await switcher() }
if (!notes.fix1RecordedOpened || notes.fix1RecordedBefore.launcher !== 'space') {
  // The defect's original subject was a BLANK chat carrying a recorded Gallery
  // space; live data changes between landings, so when no such chat exists any
  // more the scenario has no subject here — (i.1)'s fresh launch and the
  // spaces package proof carry S11 fix 1.
  notes.fix1RecordedSkipped = `no blank recorded-space chat in this data (row found: ${notes.fix1RecordedOpened})`
}
if (notes.fix1RecordedOpened && notes.fix1RecordedBefore.launcher === 'space') {
  await clickSel('[data-launcher-step="space"] [data-space="chat"]')
  await until(`document.querySelector('[data-launcher-step="brain"]')`)
  await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
  await untilBrainReady(30000)
  notes.fix1RecordedImmediate = await switcher()
  check('(i) the recorded-Gallery chat shows no raw id the instant Coding lands', RAW_ID.test(label(notes.fix1RecordedImmediate)), false)
  await wait(4000)
  notes.fix1RecordedSettled = await switcher()
  check('(i) the recorded-Gallery chat names Coding, not its recorded space', [notes.fix1RecordedSettled?.space, notes.fix1RecordedSettled?.current], ['chat', 'coding'])
  check('(i) the recorded-Gallery label reads a name, not an id', label(notes.fix1RecordedSettled), 'Coding')
  await shot('15-fix1-recorded-space-chat')
  // (i.3) the same chat after a reload: the switcher still names its brain.
  await send('Page.reload')
  await untilBrainReady(60000)
  await wait(6000)
  notes.fix1AfterReload = await switcher()
  check('(i) the label survives a reload without becoming an id', RAW_ID.test(label(notes.fix1AfterReload)), false)
  check('(i) the label still names the brain after a reload', [notes.fix1AfterReload?.space, notes.fix1AfterReload?.current], ['chat', 'coding'])
  await shot('16-fix1-after-reload')
} else {
  notes.fix1RecordedSettled = notes.fix1RecordedBefore.switcher
  if (notes.fix1RecordedSkipped === undefined) check('(i) the recorded-Gallery chat offered its space chooser', notes.fix1RecordedBefore.launcher, 'space')
}

// (j) S11 fix 2: New chat on a launched-but-unsent chat mints a different
// session and shows the space chooser. The session directories the host writes
// are the identity: a reused chat adds none.
notes.chooserForFix2 = await freshChooser('idealize', 'fix2')
await clickSel('[data-launcher-step="space"] [data-space="chat"]')
await until(`document.querySelector('[data-launcher-step="brain"]')`)
await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
await untilBrainReady(30000)
await wait(4000)
notes.fix2FirstSession = await sessionId()
notes.fix2FirstSwitcher = await switcher()
check('(j) the first chat launched into Coding', [notes.fix2FirstSwitcher?.space, notes.fix2FirstSwitcher?.current], ['chat', 'coding'])
// Nothing is sent. New chat must not hand this chat back. (Selected by class:
// a blank chat row also reads "New chat", so no text match.)
await clickSel('button[class*="newChat"], button[class*="newSession"]')
notes.fix2ChooserAfterLaunch = await until(`document.querySelector('[data-launcher-step="space"]')`, 20000)
check('(j) New chat on a launched-but-unsent chat shows the space chooser', notes.fix2ChooserAfterLaunch, true)
await shot('17-fix2-new-chat-chooser')
if (notes.fix2ChooserAfterLaunch) {
  await clickSel('[data-launcher-step="space"] [data-space="chat"]')
  await until(`document.querySelector('[data-launcher-step="brain"]')`)
  await clickSel('[data-launcher-step="brain"] [data-brain="design"]')
  await untilBrainReady(30000)
  await wait(4000)
  // The switcher mounts before the client binds the new chat under load; a
  // reused chat never changes id, so waiting for a different one masks nothing.
  notes.fix2SecondSession = await sessionId()
  for (let attempt = 0; attempt < 20 && notes.fix2SecondSession === notes.fix2FirstSession; attempt += 1) {
    await wait(1000)
    notes.fix2SecondSession = await sessionId()
  }
  check('(j) both chats report a session id', typeof notes.fix2FirstSession === 'string' && typeof notes.fix2SecondSession === 'string', true)
  check('(j) the chat New chat opened is a different session', notes.fix2SecondSession !== notes.fix2FirstSession, true)
  notes.fix2SecondSwitcher = await switcher()
  check('(j) the new session lands on the brain it was given', [notes.fix2SecondSwitcher?.space, notes.fix2SecondSwitcher?.current], ['chat', 'design'])
  await shot('18-fix2-second-session')
}

// (k) Studio is a pinned chat (JJ, 3 Sep: "like the lead agent in v0") and
// spans every project (JJ, 3 Sep: "the studio is for all projects"). No rail
// button; one card above the projects opens the one Studio chat in the canvas
// with the ordinary composer (JJ: "the same ask bar at the bottom as other
// views"). A send from that composer never reaches a model: the host takes the
// turn at pre-step and records it, so the walk's never-send-a-message rule
// holds. Typing @ offers the agents (JJ: "the @ in the ask bar should
// autocomplete the agents").
notes.railForStudio = await js(`return [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()).filter(Boolean)`)
check('(k) Studio is off the tool rail', notes.railForStudio.some(l => /^Studio$/i.test(l)), false)
notes.studioCard = await js(`
  const card = document.querySelector('[data-studio-card]')
  if (card === null) return null
  const tree = document.querySelector('[role="tree"]')
  const above = tree !== null && (card.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return { pinned: card.closest('[data-sidebar-pinned]') !== null, above, label: card.getAttribute('aria-label'), text: card.textContent,
    presence: card.querySelector('[data-studio-card-presence]')?.getAttribute('data-studio-card-presence') ?? null,
    current: card.hasAttribute('data-current') }`)
check('(k) the Studio card is pinned above the project tree', [notes.studioCard?.pinned, notes.studioCard?.above], [true, true])
check('(k) the card opens the one Studio, naming no project', [notes.studioCard?.label, /every project/i.test(notes.studioCard?.text ?? '')], ['Open the Studio', true])
await shot('19-studio-card')
const studioChatCount = () => js(`
  const r = await fetch('/api/session.list', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session.list', payload: {} }) })
  const body = await r.json()
  return body.result?.value?.items?.filter(item => item.projections?.values?.space?.space === 'studio').length ?? null`)
notes.studioChatsBefore = await studioChatCount()
await clickSel('[data-studio-card]')
await until(`document.querySelector('[data-studio-pane]')`, 30000)
await wait(3000)
// A Studio chat left behind by a removed project is not reused (8 Sep 2026: JJ's data
// held two such orphans), so the first press may mint one fresh chat, never more.
notes.studioChatsOpened = await studioChatCount()
check('(k) the card reuses a held Studio chat or mints one fresh chat, never more', typeof notes.studioChatsBefore === 'number' && notes.studioChatsOpened <= notes.studioChatsBefore + 1, true)
notes.studioOpen = await js(`
  const pane = document.querySelector('[data-studio-pane]')
  const drawer = pane?.closest('[data-drawer], [role="complementary"]') ?? null
  const seat = document.querySelector('[data-composer-seat]')
  const seatShown = seat !== null && getComputedStyle(seat).display !== 'none'
  const textarea = document.querySelector('[data-composer-seat] textarea')
  const box = textarea?.getBoundingClientRect() ?? null
  return { pane: pane !== null, inDrawer: drawer !== null, ownComposer: pane?.querySelector('[data-studio-composer]') !== null,
    error: document.querySelector('[data-studio-error]') !== null, blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
    chatComposerShown: seatShown, textareaOnScreen: box !== null && box.width > 0 && box.bottom <= window.innerHeight,
    projects: document.querySelectorAll('[data-studio-project]').length, launcher: document.querySelector('[data-launcher-step]') !== null,
    cardCurrent: document.querySelector('[data-studio-card]')?.hasAttribute('data-current') ?? null }`)
check('(k) the card opens the Studio chat in the canvas, not a drawer', [notes.studioOpen.pane, notes.studioOpen.inDrawer, notes.studioOpen.blankView], [true, false, 'studio'])
check('(k) the Studio chat carries the ordinary composer, on screen, and no composer of its own', [notes.studioOpen.chatComposerShown, notes.studioOpen.textareaOnScreen, notes.studioOpen.ownComposer, notes.studioOpen.launcher, notes.studioOpen.error], [true, true, false, false, false])
check('(k) the card marks itself current while its chat is open', notes.studioOpen.cardCurrent, true)
// JJ, 8 Sep: "the studio looks like it's selected"; "I'd like the owl to live here, rather than the placeholder copy".
notes.studioLook = await js(`
  const card = document.querySelector('[data-studio-card]')
  const wrap = document.querySelector('[data-studio-card-wrap]')
  const empty = document.querySelector('[data-studio-empty]')
  // The app's UI scale (a zoom on an ancestor) reports a 1px rule as a fraction of a pixel; a hairline is any width up to one.
  const rule = wrap ? getComputedStyle(wrap).borderBottomWidth : null
  return { rule, hairline: rule !== null && parseFloat(rule) > 0 && parseFloat(rule) <= 1,
    accentBar: card ? [...card.children].some(c => c.tagName === 'SPAN' && c.children.length === 0 && getComputedStyle(c).width === '3px') : null,
    emptyShown: empty !== null, owl: empty?.querySelector('[data-studio-owl] img') !== null,
    subtitleGone: !/coordination at a glance/i.test(document.querySelector('[data-studio-pane]')?.textContent ?? '') }`)
check('(k) the Studio card reads as a row: a hairline under it, no permanent accent bar, no coordination subtitle', [notes.studioLook.hairline, notes.studioLook.accentBar, notes.studioLook.subtitleGone], [true, false, true])
if (notes.studioLook.emptyShown) check('(k) an empty Studio shows the owl', notes.studioLook.owl, true)
await shot('20-studio-chat')
// The @ menu: the named chats across every project (the source reads the
// same session list) must be offered; the walk checks the first name.
notes.studioAgents = await js(`
  const r = await fetch('/api/session.list', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session.list', payload: {} }) })
  const body = await r.json()
  return (body.result?.value?.items ?? []).map(item => item.projections?.values?.agentName?.name).filter(name => typeof name === 'string' && name !== '')`)
await js(`document.querySelector('[data-composer-seat] textarea')?.focus(); return true`)
await send('Input.insertText', { text: '@' })
const firstAgent = notes.studioAgents?.[0] ?? null
notes.atMenu = firstAgent === null ? null : await until(`(document.body.textContent ?? '').includes(${JSON.stringify(firstAgent)})`, 10000)
check('(k) typing @ offers the agents', firstAgent === null ? 'no named chat in this project' : notes.atMenu, firstAgent === null ? 'no named chat in this project' : true)
await shot('21-studio-at-menu')
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await js(`const t = document.querySelector('[data-composer-seat] textarea'); if (t) { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })) } return true`)
const GROUP_POST = 'landing walk group post: the group chat ships'
await js(`document.querySelector('[data-composer-seat] textarea')?.focus(); return true`)
await send('Input.insertText', { text: GROUP_POST })
await wait(500)
notes.studioPost = await js(`return { typed: document.querySelector('[data-composer-seat] textarea')?.value ?? null }`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
check('(k) the ordinary composer accepted an unaddressed message', notes.studioPost.typed, GROUP_POST)
// 45s, not 20s: the post reaches the timeline in ~1.2s on a cold app and
// under 5ms on a warm one (three timed probes each), but this step runs after
// (j) has just minted two sessions on a machine at load 150, and the 4 Sep
// walk read the row about five seconds after its 20s window closed.
notes.studioPosted = await until(`[...document.querySelectorAll('[data-studio-event]')].some(row => row.textContent.includes(${JSON.stringify(GROUP_POST)}))`, 45000)
check('(k) the group post lands on the timeline through the host, waking no model', notes.studioPosted, true)
notes.studioPostRow = await js(`return [...document.querySelectorAll('[data-studio-event]')].find(row => row.textContent.includes(${JSON.stringify(GROUP_POST)}))?.textContent ?? null`)
check('(k) the group post invokes nobody', typeof notes.studioPostRow === 'string' && !notes.studioPostRow.includes('→'), true)
// Before the post the live data held no Studio timeline (the view said so);
// the broadcast records one per project, and the view lists each under its
// own heading with the row tagged by project.
notes.studioProjects = await js(`return [...document.querySelectorAll('[data-studio-project]')].map(p => p.getAttribute('data-studio-project') ?? p.querySelector('h3')?.textContent ?? '')`)
check('(k) the Studio lists every project the post landed on, each with its timeline', Array.isArray(notes.studioProjects) && notes.studioProjects.length >= 2, true)
await shot('22-studio-group-post')
// Away and back: the card reopens the same chat rather than minting another.
await newChat()
await wait(800)
notes.studioCardAtRest = await js(`
  const card = document.querySelector('[data-studio-card]')
  return { current: card?.hasAttribute('data-current') ?? null, background: card ? getComputedStyle(card).backgroundColor : null }`)
check('(k) the Studio card at rest is not marked current and carries no fill', [notes.studioCardAtRest.current, notes.studioCardAtRest.background], [false, 'rgba(0, 0, 0, 0)'])
await clickSel('[data-studio-card]')
await until(`document.querySelector('[data-studio-pane]')`, 30000)
await wait(2000)
notes.studioChatsAfter = await studioChatCount()
check('(k) reopening the card mints no second Studio chat', notes.studioChatsAfter, notes.studioChatsOpened)
notes.studioInTree = await js(`return [...document.querySelectorAll('[aria-label^="Chat actions for "]')].some(h => /^Chat actions for Studio/i.test(h.getAttribute('aria-label')))`)
check('(k) the Studio chat is not a sidebar row', notes.studioInTree, false)

// (l) Gallery layout (JJ, 3 Sep): aspect and count sit on the composer's tool
// row, and the media folders are editable in General settings.
await newChat()
notes.chooserForGalleryRow = await freshChooser('idealize', 'gallery')
notes.galleryRowEntry = await landIn('gallery', '[data-gallery-aspect]')
const galleryBrainForRow = notes.galleryRowEntry.landed ? (notes.galleryRowEntry.brain ?? 'gallery') : undefined
if (galleryBrainForRow !== undefined) {
  await wait(1500)
  notes.galleryControls = await js(`
    const aspect = document.querySelector('[data-gallery-aspect]')
    const count = document.querySelector('[data-gallery-count]')
    const card = aspect?.closest('[data-composer-card]') ?? null
    const plus = card?.querySelector('button[aria-label], button[title]') ?? null
    const a = aspect?.getBoundingClientRect(), c = count?.getBoundingClientRect()
    return { aspect: aspect !== null, count: count !== null, inCard: card !== null,
      sameRow: a !== undefined && c !== undefined && Math.abs(a.top - c.top) < 4,
      hint: document.querySelector('[data-gallery-settings-hint]') !== null,
      planIcon: document.querySelector('[data-plan-toggle]') !== null,
      settings: document.querySelectorAll('[data-gen-settings-space] [data-gen-setting-kind] [data-gen-setting]').length,
      labelsShown: [...document.querySelectorAll('[data-gen-settings-space] [data-gen-setting-kind] span')].filter(e => e.getBoundingClientRect().height > 0).length }`)
  check('(l) the Gallery controls sit inside the composer card on one row', [notes.galleryControls.aspect, notes.galleryControls.count, notes.galleryControls.inCard, notes.galleryControls.sameRow], [true, true, true, true])
  check('(l) the Images composer offers no plan icon, and every setting shows its word', [notes.galleryControls.planIcon, notes.galleryControls.labelsShown >= notes.galleryControls.settings], [false, true])
  await shot('23-gallery-tool-row')
} else {
  check('(l) Gallery offers a brain for the tool-row check', false, true)
}
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true, bubbles: true, cancelable: true })); return true`)
await until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 10000)
await wait(1000)
if (!await js(`return document.querySelector('[data-artefact-folder="images"]') !== null`)) {
  await js(`[...document.querySelectorAll('[role="dialog"] button, [role="dialog"] a')].find(e => /^General$/i.test((e.textContent ?? '').trim()))?.click(); return true`)
  await wait(1000)
}
notes.folderRow = await js(`
  const fields = ['images', 'sounds', 'video', 'archive']
  return Object.fromEntries(fields.map(f => [f, document.querySelector('[data-artefact-folder="' + f + '"]')?.value ?? null]))`)
check('(l) General settings offers the media folders at their defaults', notes.folderRow, { images: 'Images', sounds: 'Sounds', video: 'Video', archive: 'Archive' })
await shot('24-settings-media-folders')
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return true`)
await wait(800)
await js(`document.querySelector('[role="dialog"][aria-modal="true"]')?.parentElement?.querySelector('[aria-hidden="true"]')?.click(); return true`)
await wait(800)

// (m) Landing 8, JJ 4 Sep: one Services list in Brains, and no field on the
// path to a key asks for a web address. The list joins the chat routes and the
// generation backends and names each service the way its company does.
await js(`[...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Brains$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))?.click(); return true`)
await until(`document.querySelector('[role="tablist"] [role="tab"]')`, 30000)
// The pane opens on Usage; the Services list belongs to the Models tab.
await js(`[...document.querySelectorAll('[role="tab"]')].find(e => /^Models$/i.test((e.textContent ?? '').trim()))?.click(); return true`)
await until(`document.querySelector('[data-services-add]')`, 30000)
// The list is a fetch: the section renders empty before /idealize/brains/services
// answers, so wait for the rows rather than for the container.
await until(`document.querySelectorAll('[data-services] [data-service]').length > 0`, 30000)
await wait(1200)
notes.servicesConnected = await js(`
  return [...document.querySelectorAll('[data-services] [data-service]')].map(e => ({
    id: e.getAttribute('data-service'), kind: e.getAttribute('data-service-kind'),
    name: e.querySelector('strong')?.textContent?.trim() ?? null,
    connected: e.hasAttribute('data-service-connected') }))`)
check('(m) Brains lists the services this app has connected', notes.servicesConnected.length > 0 && notes.servicesConnected.every(r => r.connected), true)
// + opens the whole list. A click can race the pane's own layout: one retry.
await clickSel('[data-services-add]')
if (!await until(`document.querySelector('[data-services-advanced]')`, 10000)) {
  await clickSel('[data-services-add]')
  await until(`document.querySelector('[data-services-advanced]')`, 10000)
}
await until(`document.querySelectorAll('[data-services] [data-service]').length > ${notes.servicesConnected.length}`, 20000)
await wait(1200)
notes.servicesAdd = await js(`
  const rows = [...document.querySelectorAll('[data-services] [data-service]')]
  return {
    rows: rows.map(e => ({ id: e.getAttribute('data-service'), kind: e.getAttribute('data-service-kind'),
      name: e.querySelector('strong')?.textContent?.trim() ?? null,
      makes: e.querySelector('small')?.textContent?.trim() ?? null })),
    groups: [...document.querySelectorAll('[data-services] [data-service-group]')].map(e => e.getAttribute('data-service-group')),
    advanced: document.querySelector('[data-services-advanced]') !== null }`)
// fal.ai is connected on JJ's data (since 5 Sep), so the connected list names it and the Add list does not repeat it.
const fal = notes.servicesConnected.find(r => /^fal/i.test(r.name ?? '')) ?? notes.servicesAdd.rows.find(r => /^fal/i.test(r.name ?? ''))
check('(m) fal.ai is listed by name as a media service', [fal?.name ?? null, fal?.kind ?? null], ['fal.ai', 'media'])
check('(m) media services lead the Add list', notes.servicesAdd.groups[0] ?? null, 'media')
check('(m) no service row is labelled by its route id', notes.servicesAdd.rows.some(r => /^[a-z0-9-]+$/.test(r.name ?? '') && (r.name ?? '') === (r.id ?? '')), false)
check('(m) the web-address card stays reachable and marked advanced', notes.servicesAdd.advanced, true)
await shot('25-services-add-list')
// Open one service's key field: it must ask for a key and nothing else.
const falRowId = fal?.id ?? notes.servicesAdd.rows[0]?.id
// The Add list shows what is not connected, so a connected service's key
// panel opens from the connected list: close the Add list first when fal is
// already connected (JJ's data since 5 Sep).
if (notes.servicesConnected.some(r => r.id === falRowId)) {
  await clickSel('[data-services-add]')
  await until(`document.querySelector('[data-service="' + ${JSON.stringify(String(falRowId))} + '"]')`, 10000)
  await wait(600)
}
await js(`[...document.querySelectorAll('[data-service="' + ${JSON.stringify(String(falRowId))} + '"] button')].find(b => /^(Connect|Change key)$/.test((b.textContent ?? '').trim()))?.click(); return true`)
await until(`document.querySelector('[data-service="' + ${JSON.stringify(String(falRowId))} + '"] input')`, 10000)
await wait(800)
notes.serviceKeyField = await js(`
  const row = document.querySelector('[data-service="' + ${JSON.stringify(String(falRowId))} + '"]')
  const fields = [...(row?.querySelectorAll('input, textarea, select') ?? [])]
  return {
    count: fields.length,
    types: fields.map(f => f.type ?? null),
    labels: fields.map(f => (f.getAttribute('aria-label') ?? f.placeholder ?? '').trim()),
    keyLink: row?.querySelector('[data-service-key-link]')?.getAttribute('href') ?? null }`)
const URLISH = /url|endpoint|base|protocol|host|address|api path/i
check('(m) the key panel asks for exactly one field', notes.serviceKeyField.count, 1)
check('(m) that field is a secret, not a web address', [notes.serviceKeyField.types[0], notes.serviceKeyField.labels.some(l => URLISH.test(l))], ['password', false])
check('(m) the key page for that service is linked under the field', typeof notes.serviceKeyField.keyLink === 'string' && /^https:/.test(notes.serviceKeyField.keyLink), true)
await shot('26-services-key-field')
await clickLabel('/^Close panel$/i'); await wait(1500)

// (n) Landing 8: Video is a space with a view. Before this landing `motion`
// had no view package, so a chat launched there could generate and never see
// the result. Add the Video brain step 2 offers, then land in it.
notes.chooserForVideo = await freshChooser('My first project', 'motion')
notes.videoEntry = await enterSpace('motion')
await wait(1200)
let videoBrain = notes.videoEntry === 'step' ? (await brainStep())?.brains?.[0] : undefined
// No Video brain exists until someone adds one, so take the offer step 2 makes
// and add it here: a person reaching this screen does exactly this.
if (notes.videoEntry === 'landed') {
  // One reachable Video brain: the tile landed the chat (JJ, 7 Sep); the
  // add-and-follow proofs below need step 2, which a single brain never shows.
  videoBrain = (await switcher())?.current ?? 'video'
} else if (videoBrain === undefined) {
  await js(`
    const step = document.querySelector('[data-launcher-step="brain"]')
    const add = [...(step?.querySelectorAll('button') ?? [])].find(b => /Add a brain for Video/.test(b.textContent ?? ''))
    add?.click(); return add !== undefined`)
  await until(`document.querySelector('[data-brains-add-space="motion"]')`, 25000)
  await wait(1500)
  notes.videoBrainSheet = await js(`
    const name = document.querySelector('[data-brains-field="name"] input')
    const model = document.querySelector('[data-brains-model]')
    const options = [...(model?.querySelectorAll('option') ?? [])].map(o => ({ value: o.value, label: o.textContent?.trim() ?? null })).filter(o => o.value !== '')
    return { space: document.querySelector('[data-brains-add-space]')?.getAttribute('data-brains-add-space') ?? null,
      named: name !== null, models: options }`)
  check('(n) the add sheet opens on Video with models that can serve it', [notes.videoBrainSheet.space, notes.videoBrainSheet.models.length > 0], ['motion', true])
  const first = notes.videoBrainSheet.models[0]?.value
  await js(`
    const set = (el, value) => {
      const proto = Object.getPrototypeOf(el)
      const desc = Object.getOwnPropertyDescriptor(proto, el instanceof HTMLSelectElement ? 'value' : 'value')
      desc.set.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const name = document.querySelector('[data-brains-field="name"] input')
    if (name) set(name, 'Video')
    const model = document.querySelector('[data-brains-model]')
    if (model) set(model, ${JSON.stringify(String(first))})
    return true`)
  await wait(600)
  await shot('27a-video-brain-sheet')
  await js(`[...document.querySelectorAll('form button[type="submit"]')].pop()?.click(); return true`)
  notes.videoBrainSaved = await until(`document.querySelector('[data-brains-add-space]') === null`, 15000)
  check('(n) the Video brain saves and closes its sheet', notes.videoBrainSaved, true)
  await wait(2000)
  // The brain now exists in the Brains list, whatever the launcher does with
  // an unkeyed route: read it back where it was written.
  notes.videoBrainListed = await js(`
    return [...document.querySelectorAll('[data-brains-space="motion"] [data-brain], [data-brains-space] [data-brain]')]
      .map(e => e.getAttribute('data-brain'))`)
  await shot('27b-video-brain-listed')
  await clickLabel('/^Close panel$/i'); await wait(1500)
  notes.chooserForVideo2 = await freshChooser('My first project', 'motion2')
  const afterAdd = await enterSpace('motion')
  await wait(1500)
  if (afterAdd === 'landed') {
    // The card saw the saved brain and, it being the one reachable brain, landed the chat from the tile.
    notes.videoEntry = 'landed'
    check('(p) the welcome card lists the brain the pane just saved', true, true)
    videoBrain = (await switcher())?.current ?? 'video'
  } else {
    notes.motionAfterAdd = await brainStep()
    check('(p) the welcome card lists the brain the pane just saved', /1 brain works in Video/.test(notes.motionAfterAdd?.summary ?? ''), true)
    videoBrain = notes.motionAfterAdd?.brains?.[0]
  }
} else {
  // (p) The card follows the pane without a re-mount: with step 2 open on
  // Video, add a second Video brain in the pane and read step 2 again.
  notes.motionBefore = await brainStep()
  await js(`[...document.querySelectorAll('nav[aria-label="Tool rail"] button')].find(e => /^Brains$/i.test((e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))?.click(); return true`)
  await until(`document.querySelector('[data-brains-space-add="motion"]')`, 30000)
  await wait(800)
  await clickSel('[data-brains-space-add="motion"]')
  await until(`document.querySelector('[data-brains-add-space="motion"]')`, 15000)
  await wait(600)
  await js(`
    const set = (el, value) => {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      desc.set.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const name = document.querySelector('[data-brains-field="name"] input')
    if (name) set(name, 'Video two')
    return true`)
  await wait(400)
  await js(`[...document.querySelectorAll('form button[type="submit"]')].pop()?.click(); return true`)
  await until(`document.querySelector('[data-brains-add-space]') === null`, 15000)
  await wait(2500)
  await clickLabel('/^Close panel$/i'); await wait(2000)
  notes.motionAfterSecond = await brainStep()
  check('(p) the welcome card follows the pane: step 2 lists the brain added while it was open', [notes.motionBefore?.brains?.length ?? 0, notes.motionAfterSecond?.brains?.length ?? 0], [1, 2])
  await shot('32-video-step-follows-pane')
  videoBrain = notes.motionAfterSecond?.brains?.[0]
}
// Landing in the Video grid needs a brain the launcher will start, and it
// starts none whose route has no key: fal is keyless on this machine (the open
// item from landing 7). When that gate holds, record it rather than failing a
// check the app is right to refuse.
notes.videoGateOnKey = videoBrain === undefined
if (videoBrain !== undefined) {
  if (notes.videoEntry !== 'landed') await clickSel(`[data-launcher-step="brain"] [data-brain="${videoBrain}"]`)
  await until(`document.querySelector('[data-gallery-root]')`, 30000)
  await wait(1500)
  notes.videoLanding = await js(`
    const root = document.querySelector('[data-gallery-root]')
    return { blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      kind: root?.getAttribute('data-gallery-kind') ?? null,
      empty: document.querySelector('[data-gallery-empty]')?.textContent?.trim() ?? null,
      strip: document.querySelector('[data-gen-settings-space]')?.getAttribute('data-gen-settings-space') ?? null,
      fields: [...document.querySelectorAll('[data-gen-settings-space="motion"] [data-gen-setting]')].map(e => e.getAttribute('data-gen-setting')),
      inCard: (document.querySelector('[data-gen-settings-space="motion"]')?.closest('[data-composer-card]') ?? null) !== null,
      compact: document.querySelector('[data-gen-settings-space="motion"]')?.hasAttribute('data-gen-settings-compact') ?? null,
      planIcon: document.querySelector('[data-plan-toggle]') !== null,
      settings: document.querySelectorAll('[data-gen-settings-space="motion"] [data-gen-setting]').length,
      labelsShown: [...document.querySelectorAll('[data-gen-settings-space="motion"] [data-gen-setting-kind] span')].filter(e => e.getBoundingClientRect().height > 0).length,
      kinds: Object.fromEntries([...document.querySelectorAll('[data-gen-settings-space="motion"] [data-gen-setting-kind]')].map(l => [l.querySelector('[data-gen-setting]')?.getAttribute('data-gen-setting'), l.getAttribute('data-gen-setting-kind')])),
      audioSwitch: (() => { const b = document.querySelector('[data-gen-settings-space="motion"] [data-gen-setting="generate_audio"]'); return b ? { type: b.type, checked: b.checked } : null })(),
      chipOverflow: (() => { const m = document.querySelector('[data-gen-settings-space="motion"]')?.closest('[class*="tools"]')?.querySelector('[class*="modes"]'); return m ? Math.max(0, m.scrollWidth - m.clientWidth) : null })(),
      // The chip keeps its box and the strip starts after it: overlap is how far the chip's right edge reaches past the strip's left.
      chipOverlap: (() => { const s = document.querySelector('[data-gen-settings-space="motion"]'); const m = s?.closest('[class*="tools"]')?.querySelector('[class*="modes"]'); const chip = m?.firstElementChild; return chip ? Math.max(0, Math.round(chip.getBoundingClientRect().right - s.getBoundingClientRect().left)) : null })(),
      modesShrunk: (() => { const m = document.querySelector('[data-gen-settings-space="motion"]')?.closest('[class*="tools"]')?.querySelector('[class*="modes"]'); const chip = m?.firstElementChild; return chip ? m.getBoundingClientRect().width + 0.5 < chip.getBoundingClientRect().width : null })(),
      count: document.querySelector('[data-gallery-count]') !== null ,
      tileVideos: document.querySelectorAll('[data-gallery-open] [data-gallery-video]').length,
      tileControls: document.querySelectorAll('[data-gallery-open] [data-gallery-video][controls]').length,
      actionsRest: (() => { const a = document.querySelector('[data-gallery-actions]'); return a ? getComputedStyle(a).visibility : null })(),
      tileWidth: (() => { const t = document.querySelector('[data-gallery-tile]'); return t ? Math.round(t.getBoundingClientRect().width) : null })() }`)
  check('(n) a Video chat lands on the Video grid', [notes.videoLanding.blankView, notes.videoLanding.kind], ['motion', 'video'])
  check('(n) the Video grid names video, not images, when the chat is empty', /No video yet/.test(notes.videoLanding.empty ?? ''), true)
  // JJ, 7 Sep: "needed a time - this should be a setting that's visible in the
  // ask bar along with anything else needed for the model to run".
  check('(n) the Video composer carries the model\'s settings strip with a Duration, inside the card, and no image count', [notes.videoLanding.strip, notes.videoLanding.fields.includes('duration'), notes.videoLanding.inCard, notes.videoLanding.count], ['motion', true, true, false])
  // JJ, 8 Sep: "add number and boolean fields to the strip". The strip's
  // switches follow the chosen model's cached schema (JJ moved the Video brain
  // from Seedance to MiniMax h3-max on 8 Sep, which offers no switch), so the
  // expectation is read from the cache: the file whose enum and number inputs
  // match the strip names the model, and its boolean inputs are the checkboxes.
  // JJ, 8 Sep: "use bigger images and hide ui elements on assets until hover"; the video tile is a preview.
  if (notes.videoLanding.tileVideos > 0) check('(n) a resting video tile shows no native controls', notes.videoLanding.tileControls, 0)
  if (notes.videoLanding.actionsRest !== null) check('(n) tile actions hide at rest', notes.videoLanding.actionsRest, 'hidden')
  if (notes.videoLanding.tileWidth !== null) check('(n) tiles are at least 320px wide', notes.videoLanding.tileWidth >= 320, true)
  check('(n) the Video composer offers no plan icon, and every setting shows its word in the compact row', [notes.videoLanding.planIcon, notes.videoLanding.labelsShown >= notes.videoLanding.settings], [false, true])
  {
    const INTERNAL = new Set(['prompt', 'seed', 'enable_safety_checker', 'safety_tolerance', 'sync_mode', 'output_format', 'system_prompt', 'limit_generations', 'enable_web_search', 'num_images', 'num_inference_steps', 'guidance_scale'])
    const dataDir = process.env.IDEALIZE_SCRATCH_DATA
    const inputsDir = dataDir === undefined ? null : join(dataDir, 'harness', 'service-catalogues', 'fal', 'inputs')
    let schema = null
    const stripNames = notes.videoLanding.fields.filter(name => notes.videoLanding.kinds[name] !== 'boolean').map(name => `${name}:${notes.videoLanding.kinds[name]}`).sort().join(',')
    try {
      for (const file of readdirSync(inputsDir)) {
        const parsed = JSON.parse(readFileSync(join(inputsDir, file), 'utf8'))
        const props = (parsed.properties ?? []).filter(prop => !INTERNAL.has(prop.name) && !/image/.test(prop.name))
        const scalar = props.filter(prop => prop.enum !== undefined || prop.type === 'number' || prop.type === 'integer').map(prop => `${prop.name}:${prop.enum !== undefined ? 'enum' : 'number'}`).sort().join(',')
        if (scalar === stripNames) { schema = { file, booleans: props.filter(prop => prop.type === 'boolean') }; break }
      }
    } catch {
      // no cache in this data: the note below says so
    }
    if (schema === null) {
      notes.videoLanding.schemaNote = 'no cached fal schema matches the strip, so the boolean check has no expectation'
    } else {
      const states = await js(`return Object.fromEntries([...document.querySelectorAll('[data-gen-settings-space="motion"] input[type="checkbox"][data-gen-setting]')].map(b => [b.getAttribute('data-gen-setting'), b.checked]))`)
      notes.videoLanding.schema = { file: schema.file, booleans: schema.booleans.map(prop => [prop.name, prop.default ?? false]), checkboxes: states }
      check('(n) the strip carries exactly the schema\'s boolean inputs as checkboxes, at the model\'s defaults', states, Object.fromEntries(schema.booleans.map(prop => [prop.name, prop.default ?? false])))
    }
  }
  // At 1280px the row is short: the strip keeps its selects alone and the mode
  // chip's box no longer overlaps it.
  // Whether the row is short depends on the model's field count (MiniMax offers three, Seedance five), so compact is recorded, not asserted.
  check('(n) the mode chip keeps its box and never runs under the settings strip', [notes.videoLanding.modesShrunk, notes.videoLanding.chipOverlap], [false, 0])
  await shot('27-video-space')
} else {
  notes.videoLanding = 'the launcher starts no chat in a space no route can serve (fal is unkeyed here)'
  check('(n) Video waits on a fal key, and says so instead of starting a chat that would fail', [notes.videoBrainSaved, notes.motionAfterAdd?.refusal ?? null], [true, 'no-compatible-model'])
}

// (o) Landing 8: the Sound Stage shows this chat's sounds. Before, it listed
// every sound in the project, so a chat that had generated nothing opened onto
// another chat's work.
notes.chooserForSound = await freshChooser('idealize', 'soundstage')
notes.soundEntry = await landIn('soundstage', '[data-soundstage]')
const soundBrain = notes.soundEntry.landed ? (notes.soundEntry.brain ?? 'soundstage') : undefined
if (soundBrain !== undefined) {
  await wait(1500)
  notes.soundLanding = await js(`
    return { blankView: document.querySelector('[data-blank-view]')?.getAttribute('data-blank-view') ?? null,
      empty: document.querySelector('[data-soundstage-empty]')?.textContent?.trim() ?? null,
      rows: document.querySelectorAll('[data-soundstage-sound]').length,
      refresh: [...document.querySelectorAll('button')].some(b => /^Refresh$/i.test((b.textContent ?? '').trim())),
      length: document.querySelector('[data-gen-settings-space="soundstage"] [data-gen-setting="duration"]') !== null,
      floating: document.querySelector('[data-soundstage-length]') !== null,
      planIcon: document.querySelector('[data-plan-toggle]') !== null }`)
  check('(o) a Sound Stage chat lands on the stage', notes.soundLanding.blankView, 'soundstage')
  check('(o) a new Sound Stage chat shows its own empty chat, not the project', [/No sounds in this chat yet/.test(notes.soundLanding.empty ?? ''), notes.soundLanding.rows], [true, 0])
  check('(o) the stage has no Refresh: the rows come from the live snapshot', notes.soundLanding.refresh, false)
  // JJ, 7 Sep: the floating Length row above the card was "still messy"; the
  // length is a compact select in the composer's settings strip.
  check('(o) the length is a select in the composer strip, and the floating Length row is gone', [notes.soundLanding.length, notes.soundLanding.floating], [true, false])
  check('(o) the Sound Stage composer offers no plan icon', notes.soundLanding.planIcon, false)
  await shot('28-sound-stage-chat-specific')
} else {
  notes.soundLanding = 'no Sound Stage brain offered'
  check('(o) Sound Stage offers a brain to land in', false, true)
}

// (q) JJ, 7 Sep: "the archive button is great - please add a 'reveal' that
// opens the file pane showing you where the file is." A stored chat with a
// finished artefact carries Reveal beside Archive; clicking it opens the Files
// pane with the file's row lit. Live data decides which chat that is.
const chatRows = () => js(`
  return [...document.querySelectorAll('[aria-label^="Chat actions for "]')].map(h => {
    const row = h.closest('li, div, a')
    return { chat: h.getAttribute('aria-label').replace('Chat actions for ', ''), space: row?.querySelector('[data-space]')?.getAttribute('data-space') ?? null }
  })`)
// The sidebar renders the rows of expanded projects only, so open each project
// in turn and look for a chat in a generating space whose view holds an artefact.
const withArtefacts = async () => {
  const projects = await js(`return [...document.querySelectorAll('[aria-label^="New chat in "]')].map(e => e.getAttribute('aria-label').replace('New chat in ', ''))`)
  notes.revealProjects = projects
  const tried = new Set()
  for (const project of [null, ...projects]) {
    if (project !== null) {
      await clickLabel(`/^${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$/i`)
      await wait(1500)
    }
    const rows = (await chatRows()).filter(r => (r.space === 'soundstage' || r.space === 'gallery' || r.space === 'motion') && !tried.has(r.chat))
    for (const candidate of rows) {
      tried.add(candidate.chat)
      if (!await sidebarRow(candidate.chat)) continue
      // A statement body, not an expression: untilValue would wrap it in parentheses.
      let found = null
      for (const end = Date.now() + 8000; found === null && Date.now() < end; await wait(300)) {
        found = await js(`
          const sound = document.querySelector('[data-soundstage-sound] [data-soundstage-reveal]')
          const tile = document.querySelector('[data-gallery-tile="done"] [data-gallery-reveal]')
          return sound ? 'soundstage' : (tile ? 'gallery' : null)`)
      }
      if (found !== null) return { project, chat: candidate.chat, space: candidate.space, kind: found }
    }
  }
  notes.revealTried = [...tried]
  return null
}
notes.revealChat = await withArtefacts()
if (notes.revealChat === null) {
  // Archived chats are not listed, and JJ archives finished chats, so the
  // button may not be on screen. The bar's half is proved on its own: a
  // project's own media file, revealed through the event the button raises.
  notes.revealSkipped = 'no listed chat in this data holds a finished artefact, so the Reveal button is not on screen; the event path is proved instead'
  const dataDir = process.env.IDEALIZE_SCRATCH_DATA
  const projectFile = () => {
    if (dataDir === undefined) return null
    let registry
    try { registry = JSON.parse(readFileSync(join(dataDir, 'harness', 'storages', 'workspace.json'), 'utf8')) } catch { return null }
    const table = (Array.isArray(registry) ? registry : Object.values(registry)).find(x => x && x.workspaces)
    for (const workspace of Object.values(table?.workspaces ?? {})) {
      for (const folder of ['Video', 'Sounds', 'Images']) {
        let names = []
        try { names = readdirSync(join(workspace.path, folder)).filter(n => /\.(mp4|wav|mp3|png|jpe?g|webp)$/i.test(n)) } catch { continue }
        if (names.length > 0) return { project: workspace.path.split('/').pop(), relPath: `${folder}/${names[0]}` }
      }
    }
    return null
  }
  notes.revealTarget = projectFile()
  if (notes.revealTarget === null) {
    notes.revealSkipped += '; and no project holds a media file to reveal'
  } else {
    await newChat()
    await freshChooser(notes.revealTarget.project, 'reveal')
    await wait(1200)
    await js(`document.dispatchEvent(new CustomEvent('idealize:reveal-artefact', { detail: { relPath: ${JSON.stringify(notes.revealTarget.relPath)} } })); return true`)
    const lit = await until(`document.querySelector('[data-revealed]')`, 20000)
    await wait(800)
    notes.revealed = await js(`
      const row = document.querySelector('[data-revealed]')
      const rect = row?.getBoundingClientRect()
      return { row: row?.textContent?.trim().slice(0, 80) ?? null,
        onScreen: rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight,
        filesPane: [...document.querySelectorAll('h1, h2, h3, [role="heading"], span[class*="title"]')].some(h => /^Files$/.test((h.textContent ?? '').trim())) }`)
    const fileName = notes.revealTarget.relPath.split('/').pop()
    check('(q) a reveal request opens the Files pane with the file\'s row lit and on screen', [lit, notes.revealed.filesPane, notes.revealed.onScreen, (notes.revealed.row ?? '').includes(fileName)], [true, true, true, true])
    await shot('29-reveal-in-files')
  }
} else {
  const button = notes.revealChat.kind === 'soundstage' ? '[data-soundstage-sound] [data-soundstage-reveal]' : '[data-gallery-tile="done"] [data-gallery-reveal]'
  notes.revealButton = await js(`
    const b = document.querySelector(${JSON.stringify(button)})
    const archive = b?.parentElement?.querySelector('button[aria-label="Archive"], button[aria-label="Keep"]') ?? null
    return { text: b?.textContent?.trim() ?? null, besideVerdict: archive !== null }`)
  check('(q) a finished artefact offers Reveal beside its verdict', [notes.revealButton.text, notes.revealButton.besideVerdict], ['Reveal', true])
  await clickSel(button)
  const lit = await until(`document.querySelector('[data-revealed]')`, 20000)
  await wait(800)
  notes.revealed = await js(`
    const row = document.querySelector('[data-revealed]')
    const rect = row?.getBoundingClientRect()
    return { row: row?.textContent?.trim().slice(0, 80) ?? null,
      onScreen: rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight,
      filesPane: [...document.querySelectorAll('h1, h2, h3, [role="heading"], span[class*="title"]')].some(h => /^Files$/.test((h.textContent ?? '').trim())) }`)
  check('(q) Reveal opens the Files pane with the file\'s row lit and on screen', [lit, notes.revealed.filesPane, notes.revealed.onScreen, notes.revealed.row !== null], [true, true, true, true])
  await shot('29-reveal-in-files')
}

// (s) Landing 15, JJ 8 Sep: the minimode bar puts the Studio first with an owl,
// paints the sidebar's background, shows the brand mark at the sidebar's size,
// drags by its background, and lists the sidebar's chats. The Askbar window is
// the app-lifetime second page target.
{
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const askbarTarget = targets.find(t => t.type === 'page' && t.url.includes('dsh-desktop-mode=askbar'))
  if (!askbarTarget) {
    notes.askbarSkipped = 'no askbar page target in this build'
  } else {
    const ws2 = new WebSocket(askbarTarget.webSocketDebuggerUrl)
    let id2 = 0
    const pending2 = new Map()
    ws2.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending2.has(m.id)) { pending2.get(m.id)(m); pending2.delete(m.id) } })
    await new Promise(r => ws2.addEventListener('open', r))
    const send2 = (method, params = {}) => new Promise((res, rej) => {
      const n = ++id2; pending2.set(n, m => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
      ws2.send(JSON.stringify({ id: n, method, params }))
    })
    const js2 = async (expr) => {
      const r = await send2('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails))
      return r.result.value
    }
    const sidebar = await js(`
      const col = document.querySelector('[data-idealize-surface="sessions"]')
      return { background: col ? getComputedStyle(col).backgroundColor : null, text: col?.textContent ?? '' }`)
    let bar = null
    for (let i = 0; i < 30 && (bar === null || bar.chips === 0); i++) {
      bar = await js2(`
        const bar = document.querySelector('[data-askbar-bar]')
        if (!bar) return null
        const buttons = [...bar.querySelectorAll('button')]
        const studio = buttons.find(b => /^Studio/.test(b.getAttribute('aria-label') ?? ''))
        const chips = [...bar.querySelectorAll('[role="list"] [data-chip-id]')]
        const brand = bar.querySelector('img')
        // The app's UI scale zooms an ancestor; sizes are read back in unzoomed pixels.
        let zoom = 1
        for (let e = bar; e; e = e.parentElement) { const z = parseFloat(getComputedStyle(e).zoom); if (z && z !== 1) zoom *= z }
        return { background: getComputedStyle(bar).backgroundColor, drag: getComputedStyle(bar).webkitAppRegion, zoom,
          noDrag: buttons.every(b => getComputedStyle(b).webkitAppRegion === 'no-drag'),
          studioIndex: studio ? buttons.indexOf(studio) : null,
          studioOwl: studio?.querySelector('img')?.getAttribute('src')?.endsWith('/idealize/askbar/owl.webp') ?? false,
          groupChat: /Group chat/i.test(bar.textContent ?? ''),
          brand: brand ? [Math.round(brand.getBoundingClientRect().width / zoom), Math.round(brand.getBoundingClientRect().height / zoom)] : null,
          chips: chips.length, chipNames: chips.map(c => (c.getAttribute('aria-label') ?? '').split(' — ')[0].trim()),
          idleWords: /disconnected/i.test(bar.textContent ?? '') }`)
      if (bar === null || bar.chips === 0) await wait(500)
    }
    notes.askbar = { sidebarBackground: sidebar.background, bar }
    check('(s) the minimode bar exists with the Studio first, an owl mark, and no Group chat', [bar !== null, bar?.studioIndex, bar?.studioOwl, bar?.groupChat], [true, 1, true, false])
    check('(s) the minimode bar paints the sidebar background and the brand mark at 58', [bar?.background, bar?.brand], [sidebar.background, [58, 58]])
    check('(s) the minimode bar drags by its background and never by a control', [bar?.drag, bar?.noDrag], ['drag', true])
    check('(s) the minimode lists chats the sidebar shows, with no Disconnected label', [bar !== null && bar.chips > 0 && bar.chipNames.every(name => name.length === 0 || sidebar.text.includes(name)), bar?.idleWords], [true, false])
    ws2.close()
  }
}

// (t) Landing 16, JJ 8 Sep item 26 ("collapse sidebar vs minimode"): one rail,
// two homes. Collapsing the sidebar seats the same rail the Askbar window
// renders (Studio entry with the owl first, then the chips), and expanding
// brings the project list back.
{
  const collapse = await js(`const b = document.querySelector('button[aria-label="Collapse sidebar"]'); if (!b) return false; b.click(); return true`)
  await wait(1200)
  notes.sidebarRail = await js(`
    const rail = document.querySelector('[data-slot="sidebar.rail"] [data-askbar-rail], [data-askbar-rail][data-home="sidebar"]')
    if (!rail) return { rail: false, collapsed: document.querySelector('[data-sidebar-collapsed]') !== null }
    const buttons = [...rail.querySelectorAll('button')]
    const studio = buttons.find(b => /^Studio/.test(b.getAttribute('aria-label') ?? ''))
    return { rail: true, home: rail.getAttribute('data-home'), collapsed: document.querySelector('[data-sidebar-collapsed]') !== null,
      studioOwl: studio?.querySelector('img')?.getAttribute('src')?.endsWith('/idealize/askbar/owl.webp') ?? false,
      width: Math.round(rail.getBoundingClientRect().width),
      workspaceRail: document.querySelector('[data-slot="sidebar.workspaces"]') !== null }`)
  await js(`document.querySelector('button[aria-label="Open sidebar"]')?.click(); return true`)
  await wait(1200)
  notes.sidebarRail.reopened = await js(`return document.querySelector('[data-sidebar-collapsed]') === null && document.querySelector('[data-askbar-rail][data-home="sidebar"]') === null`)
  check('(t) collapsing the sidebar seats the minimode rail in-window, Studio owl first, and expanding restores the project list', [collapse, notes.sidebarRail.rail, notes.sidebarRail.home, notes.sidebarRail.studioOwl, notes.sidebarRail.reopened], [true, true, 'sidebar', true, true])
}

// (u) Landing 16, JJ 8 Sep item 9 ("owl-style space icons"): the launcher tiles
// and the sidebar's space lane draw the six icons served by @idealize/spaces.
{
  // Two spellings on screen: an <img> where the icon is the element, and a
  // <span> masked in currentColor through --space-icon (landing 16's sidebar
  // and card glyphs), which carries the same URL and paints no pixels of its
  // own until the mask loads.
  notes.spaceIcons = await js(`
    const nodes = [...document.querySelectorAll('[data-space-icon]')]
    const read = el => {
      const src = el.getAttribute('src')
      if (src !== null) return { src, painted: el.complete && el.naturalWidth > 0 }
      const value = getComputedStyle(el).getPropertyValue('--space-icon').trim()
      const match = /^url\\(["']?(.*?)["']?\\)$/.exec(value)
      const box = el.getBoundingClientRect()
      return { src: match === null ? null : match[1], painted: box.width > 0 && box.height > 0 }
    }
    const entries = nodes.map(read)
    const srcs = [...new Set(entries.map(e => e.src).filter(s => s !== null))]
    const fetched = await Promise.all(srcs.map(async src => { const r = await fetch(src); return [src.replace(/.*\\/icons\\//, ''), r.status, r.headers.get('content-type')] }))
    const route = /\\/idealize\\/spaces\\/icons\\/(chat|terminal|gallery|soundstage|motion|studio)\\.svg$/
    return { count: nodes.length, srcs, fetched, painted: entries.filter(e => e.painted).length,
      allRoute: entries.every(e => e.src !== null) && srcs.every(s => route.test(s)) }`)
  check('(u) every space icon on screen is one of the six served SVGs and each one loads', [notes.spaceIcons.count > 0, notes.spaceIcons.allRoute, notes.spaceIcons.fetched.every(([, status, type]) => status === 200 && /image\/svg\+xml/.test(type ?? '')), notes.spaceIcons.painted === notes.spaceIcons.count], [true, true, true, true])
}

// (v) Landing 17, JJ 8 Sep ("what about Fal? and also the subscription models?"):
// the Budget tab counts what the generating spaces made this month beside the
// token table, and says plainly when fal has not priced it.
{
  const opened = await openBrains()
  await js(`[...document.querySelectorAll('[role="tab"]')].find(e => /^Budget$/i.test((e.textContent ?? '').trim()))?.click(); return true`)
  await until(`document.querySelector('[data-generations]')`, 20000)
  notes.budget = await js(`
    const spend = document.querySelector('[data-spend-models]')
    const gen = document.querySelector('[data-generations]')
    if (!gen) return { spend: spend !== null, generations: false }
    const rows = [...gen.querySelectorAll('[data-generation-row]')]
    const text = (gen.textContent ?? '').trim()
    return { spend: spend !== null, generations: true,
      rows: rows.map(r => r.getAttribute('data-generation-row')),
      billedRows: rows.filter(r => !/not billed yet/i.test(r.textContent ?? '')).length,
      state: rows.length > 0 ? 'rows'
        : /Connect fal/i.test(text) ? 'no key'
        : /did not report/i.test(text) ? 'error'
        : /No generations this month/i.test(text) ? 'none' : 'unknown',
      errorNote: document.querySelector('[data-generations-error]')?.textContent?.trim() ?? null,
      connectNote: document.querySelector('[data-generations-connect]')?.textContent?.trim() ?? null,
      catalogueSource: /model catalogue the app ships/i.test(document.body.textContent ?? '') }`)
  check('(v) the Budget tab carries the token table and a generations section in a state it can explain', [opened, notes.budget.spend, notes.budget.generations, notes.budget.state !== 'unknown'], [true, true, true, true])
  // JJ's data (8 Sep 2026) carries a fal key fal refuses for its usage API
  // ("This API key is not permitted to perform this action"), so the rows are
  // what this app made and the money is missing: the section must say why
  // rather than leave a table of blanks.
  check('(v) a generations table with nothing billed says why', notes.budget.rows.length === 0 || notes.budget.billedRows > 0 || notes.budget.errorNote !== null || notes.budget.connectNote !== null, true)
}

// (r) Landing 14, JJ 8 Sep ("i think we have some rogue Buzz code?!"): the
// `idealize` command every agent's prompt names exists in the agent's shell,
// published beside pnpm under the app's runtime-commands directory.
{
  const dataDir = process.env.IDEALIZE_SCRATCH_DATA
  const shim = dataDir === undefined ? null : join(dataDir, 'runtime-commands', 'bin', 'idealize')
  let text = null
  let mode = null
  try {
    text = readFileSync(shim, 'utf8')
    mode = statSync(shim).mode & 0o777
  } catch {
    // absent or unreadable: the check below reports it
  }
  notes.idealizeShim = { shim, present: text !== null, runsCommCli: text?.includes('@idealize/comm/lib/cli.js\' "$@"') ?? false, mode }
  check('(r) the packaged app publishes the idealize command beside pnpm, running the comm CLI', [notes.idealizeShim.present, notes.idealizeShim.runsCommCli, notes.idealizeShim.mode], [true, true, 0o700])
}

// (w) Landing 19, JJ 9 Sep ("the main ask bar settings is a mess"): the two
// standing settings live behind the composer's three-dot control, the media
// space's own settings read as a set, and the send button keeps the action
// colour while the composer is empty.
{
  // A fresh Images chat, so the settings strip renders on its own composer.
  await newChat()
  notes.overflowChooser = await freshChooser('idealize', 'gallery')
  notes.overflowEntry = await landIn('gallery', '[data-gallery-aspect]')
  await wait(1500)
  notes.overflowRow = await js(`
    const card = document.querySelector('[data-composer-card]') ?? document.body
    return {
      trigger: card.querySelector('[data-composer-overflow-trigger]') !== null,
      switcherOnRow: card.querySelector('[data-brain-switcher]') !== null,
      accessOnRow: [...card.querySelectorAll('button')].some(b => /^Workspace |^Read Only|^Full access/.test((b.getAttribute('aria-label') ?? '').replace(/^Access mode: /, ''))),
      strip: card.querySelector('[data-gen-settings-space]') !== null }`)
  check('(w) the tool row carries the three-dot control and neither standing chip', [notes.overflowRow.trigger, notes.overflowRow.switcherOnRow], [true, false])

  const opened = await openOverflow()
  notes.overflowPanel = await js(`
    const panel = document.querySelector('[data-composer-overflow-panel]')
    if (panel === null) return null
    return {
      labels: [...panel.querySelectorAll('span')].map(e => e.textContent.trim()).filter(t => /^(Project access|Brain)$/.test(t)),
      switcher: panel.querySelector('[data-brain-switcher]') !== null,
      access: [...panel.querySelectorAll('button')].some(b => /Access mode/.test(b.getAttribute('aria-label') ?? '')) }`)
  check('(w) the panel names both settings and holds both controls',
    [opened, notes.overflowPanel?.labels.sort(), notes.overflowPanel?.switcher, notes.overflowPanel?.access],
    [true, ['Brain', 'Project access'], true, true])
  await shot('30-composer-overflow-panel')
  await closeOverflow()

  // Every setting reads label-above-control, at every row width: the label's
  // box sits wholly above its control's box, and a duration's unit stays
  // beside the number rather than dropping to a third line.
  notes.settingsStrip = await js(`
    const row = document.querySelector('[data-gen-settings-space]')
    if (row === null) return null
    const controls = [...row.querySelectorAll('label')].filter(l => l.getAttribute('data-gen-setting-kind') !== 'boolean')
    const stacked = controls.map((l) => {
      const label = l.querySelector('span')
      const field = l.querySelector('select, input')
      if (label === null || field === null) return null
      return label.getBoundingClientRect().bottom <= field.getBoundingClientRect().top + 1
    })
    const selects = [...row.querySelectorAll('select')].map(e => Math.round(e.getBoundingClientRect().width))
    return { count: controls.length, stacked, lines: new Set(controls.map(l => Math.round(l.getBoundingClientRect().height))).size, selects,
      widest: Math.max(0, ...selects), narrowest: Math.min(9999, ...selects) }`)
  check('(w) every setting stacks its label above its control',
    [notes.settingsStrip !== null, notes.settingsStrip?.stacked.every(v => v === true)], [true, true])
  // One width floor, so the selects read as a set rather than three widths.
  check('(w) no select is narrower than the strip\'s floor', notes.settingsStrip === null || notes.settingsStrip.narrowest >= 50, true)
  await shot('31-generation-settings-strip')

  // The send button, with an empty composer, keeps the chosen action colour.
  // The send circle is the card's own disabled primary button: found by class
  // rather than by label, which the walk's data renders in either locale.
  notes.sendButton = await js(`
    const card = document.querySelector('[data-composer-card]') ?? document.body
    const send = [...card.querySelectorAll('button[class*="primary"]')].filter(b => b.disabled).pop()
      ?? [...card.querySelectorAll('button')].find(b => /send|发送/i.test(b.getAttribute('aria-label') ?? ''))
    if (send === undefined || send === null) return null
    const style = getComputedStyle(send)
    return { label: send.getAttribute('aria-label'), disabled: send.disabled, opacity: style.opacity, background: style.backgroundColor }`)
  check('(w) an empty composer dims the send button to 0.75, not 0.4',
    [notes.sendButton !== null, notes.sendButton?.disabled, notes.sendButton?.opacity], [true, true, '0.75'])
}

// (x) Landing 20, JJ 9 Sep ("then do the ask bar"): the Askbar's hold gesture
// speaks, and the speech is transcribed on this machine. The walk cannot talk
// into a microphone, so it proves the three things around the capture: the seam
// publishes an on-device provider, nothing was downloaded at boot, and a hold
// on the rail meets the notice that says where the audio goes.
{
  notes.speechState = await js(`
    const response = await fetch('/idealize/transcribe/state')
    if (!response.ok) return { status: response.status }
    const body = await response.json()
    return { status: response.status, providers: body.providers, readiness: body.readiness?.state ?? null }`)
  check('(x) the transcription seam publishes one on-device provider', [
    notes.speechState?.status,
    notes.speechState?.providers?.length,
    notes.speechState?.providers?.[0]?.location,
    notes.speechState?.providers?.[0]?.sampleRate,
  ], [200, 1, 'on-device', 16000])

  // The model is fetched on a first capture, not at boot. This data directory
  // has never spoken, so the cache under the harness home does not exist and
  // the seam reads as preparing rather than ready.
  const dataDir = process.env.IDEALIZE_SCRATCH_DATA
  notes.speechModelCache = dataDir === undefined
    ? null
    : (() => { try { return readdirSync(join(dataDir, 'harness', 'speech-models')).length } catch { return 'absent' } })()
  check('(x) booting fetches no model, and the seam says so',
    [notes.speechModelCache, notes.speechState?.readiness], ['absent', 'preparing'])

  // The rail seats in the collapsed sidebar in this window, so collapse it and
  // hold a chip there. A first hold meets the notice, which is the gate on the
  // microphone: nothing records until someone accepts it.
  notes.speechNotice = await js(`
    localStorage.removeItem('idealize.askbar.speechNotice')
    // Earlier sections leave the Brains drawer open over a scrim; close it so
    // the notice card is the thing the shot shows.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 400))
    const collapse = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') ?? '') === 'Collapse sidebar')
    if (collapse === undefined) return { collapse: false }
    collapse.click()
    // Let the collapse settle: the layout shift under a resting cursor fires a
    // pointerleave on whatever it lands on, which is how a hold is abandoned.
    await new Promise(resolve => setTimeout(resolve, 2000))
    const rail = document.querySelector('[data-askbar-rail]')
    if (rail === null) return { collapse: true, rail: false }
    const chip = rail.querySelector('[data-chip-id]')
    if (chip === null) return { collapse: true, rail: true, home: rail.getAttribute('data-home'), chip: false }
    // The rail re-renders on its roster poll, and a re-render lands often enough
    // to clear a pending hold timer, so press again until the card is up.
    let card = null
    for (let attempt = 0; attempt < 6 && card === null; attempt++) {
      const target = rail.querySelector('[data-chip-id]')
      target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0 }))
      for (let tick = 0; tick < 5 && card === null; tick++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        card = document.querySelector('[data-hold-phase]')
      }
    }
    const text = card?.textContent ?? ''
    return {
      collapse: true, rail: true, home: rail.getAttribute('data-home'), chip: true,
      phase: card === null ? null : card.getAttribute('data-hold-phase'),
      onDevice: /reaches no network/.test(text),
      neverWritten: /never written to disk/.test(text),
      accept: card !== null && card.querySelector('[data-speech-notice-accept]') !== null,
      drawer: document.querySelector('[role="dialog"]') !== null,
    }`)
  check('(x) a hold on the collapsed rail meets the notice, which states the audio stays on this Mac',
    [notes.speechNotice?.home, notes.speechNotice?.phase, notes.speechNotice?.onDevice,
      notes.speechNotice?.neverWritten, notes.speechNotice?.accept],
    ['sidebar', 'notice', true, true, true])
  await wait(400)
  await shot('32-askbar-speech-notice')

  // Leave the window as the walk found it.
  await js(`
    const card = document.querySelector('[data-hold-phase]')
    card?.querySelector('[data-speech-notice-accept]')?.click()
    localStorage.removeItem('idealize.askbar.speechNotice')
    await new Promise(resolve => setTimeout(resolve, 300))
    return true`)
  // The expand click stands alone: an evaluation still awaiting when the click
  // rebuilds the tree is collected, and CDP reports the loss, not the result.
  await js(`
    [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') ?? '') === 'Open sidebar')?.click()
    return true`)
  await until(`document.querySelector('[data-sidebar-collapsed]') === null`, 15000)
}

// (y) Landing 21, JJ 9 Sep: A6 of the Askbar plan — the pilot-entry journey.
// An agent asks the person something, the alert reaches them, opening it lands
// the Studio on that exact event, answering it is the only thing that resolves
// it, and a cut to the pane's own reads loses nothing. Run with the
// coordinator reachable and unreachable, because direct routes must keep
// working either way (FR-P0-22).
{
  const AUTH = `{ 'x-idealize-auth': '1', 'content-type': 'application/json' }`
  // The project the walk's app holds: the Studio spans every project, and the
  // journey needs one folder to record against.
  notes.journeyProject = await js(`
    const r = await fetch('/api/workspace.list', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'workspace.list', payload: {} }) })
    const body = await r.json()
    return body.result?.value?.items?.[0]?.path ?? null`)
  const PROJECT = notes.journeyProject
  check('(y) the walk has a project to coordinate in', typeof PROJECT === 'string' && PROJECT.length > 0, true)

  // The pinned Studio card lives in the expanded sidebar; an earlier section
  // may have left it collapsed onto the rail.
  await js(`
    if (document.querySelector('[data-sidebar-collapsed]') !== null) {
      [...document.querySelectorAll('button')]
        .find(b => (b.getAttribute('aria-label') ?? '') === 'Open sidebar')?.click()
    }
    return true`)
  notes.journeyCardSeated = await until(`document.querySelector('[data-studio-card]')`, 15000)
  check('(y) the pinned Studio card is on screen for the journey', notes.journeyCardSeated, true)

  const post = (path, body) => js(`
    const r = await fetch(${JSON.stringify(path)}, { method: 'POST', headers: ${AUTH}, body: JSON.stringify(${JSON.stringify(body)}) })
    return { status: r.status, body: await r.json().catch(() => null) }`)

  if (typeof PROJECT === 'string' && PROJECT.length > 0) {
    const record = (event) => js(`
      const r = await fetch('/idealize/studio/event', { method: 'POST', headers: ${AUTH},
        body: JSON.stringify(Object.assign({ project: ${JSON.stringify(PROJECT)} }, ${JSON.stringify(event)})) })
      const body = await r.json().catch(() => null)
      return { status: r.status, id: body?.event?.id ?? null, seq: body?.event?.seq ?? null }`)
    const deliver = (event) => js(`
      const r = await fetch('/idealize/studio/deliver', { method: 'POST', headers: ${AUTH},
        body: JSON.stringify(Object.assign({ project: ${JSON.stringify(PROJECT)} }, ${JSON.stringify(event)})) })
      const body = await r.json().catch(() => null)
      return { status: r.status, delivery: body?.delivery ?? null, id: body?.event?.id ?? null }`)
    const ledger = () => js(`
      const r = await fetch('/idealize/notify/attention')
      if (!r.ok) return { status: r.status }
      return Object.assign({ status: r.status }, await r.json())`)
    const studioState = () => js(`
      const r = await fetch('/idealize/studio/state?project=' + encodeURIComponent(${JSON.stringify(PROJECT)}))
      return r.ok ? await r.json() : { status: r.status }`)

    // 1. Presence: one truth, two surfaces. The roster says which chats are
    // running; the Studio's presence must say the same about the same ids.
    const stamp = Date.now()
    notes.journeyRoster = await js(`
      const r = await fetch('/idealize/askbar/roster?project=' + encodeURIComponent(${JSON.stringify(PROJECT)}))
      const body = await r.json()
      return (body.chips ?? []).map(chip => ({ id: chip.id, running: chip.running }))`)
    // Chosen once presence is read: delivery needs a participant the host can
    // reach, which is a live agent, not one executing a turn right now.
    let liveChip = null
    const OFFLINE = `walk-offline-${stamp}`
    for (const chip of notes.journeyRoster ?? []) {
      await record({ author: 'user', kind: 'assignment', subtype: 'new-task', taskId: `walk-presence-${chip.id}`, target: chip.id, body: 'Presence check' })
    }
    await record({ author: 'user', kind: 'assignment', subtype: 'new-task', taskId: `walk-offline-${stamp}`, target: OFFLINE, body: 'Nobody runs this' })
    const presenceState = await studioState()
    const rosterIds = new Set((notes.journeyRoster ?? []).map(chip => chip.id))
    notes.journeyPresence = {
      // `running` is whether a chat is executing a turn right now, which is a
      // different question from reachability, so the agreement to hold the two
      // surfaces to is that presence invents nobody: every participant the
      // Studio calls reachable is a chat this project's roster lists.
      invented: Object.entries(presenceState.presence ?? {})
        .filter(([id, value]) => value === 'reachable' && !rosterIds.has(id)).map(([id]) => id),
      offline: presenceState.presence?.[OFFLINE] ?? null,
      running: (notes.journeyRoster ?? []).filter(chip => chip.running)
        .map(chip => presenceState.presence?.[chip.id] ?? null),
    }
    check('(y) the Studio calls nobody reachable that the roster does not list, and a participant that is no chat is unreachable',
      [notes.journeyPresence.invented, notes.journeyPresence.offline], [[], 'unreachable'])
    // A chat executing a turn is a live agent, so it must read reachable.
    check('(y) every running chat reads reachable in the Studio',
      notes.journeyPresence.running.every(value => value === 'reachable'), true)
    liveChip = (notes.journeyRoster ?? []).find(chip => presenceState.presence?.[chip.id] === 'reachable') ?? null
    check('(y) the journey has a reachable participant to address', liveChip !== null, true)

    // 2. The coordinator offline: an addressed message still records and its
    // delivery queues rather than vanishing.
    notes.journeyQueued = await deliver({
      author: 'user', kind: 'message', target: OFFLINE, body: 'Pick this up when you are back.',
      messageId: `walk-offline-${stamp}`,
    })
    check('(y) a message to an unreachable participant records and queues, losing nothing',
      [notes.journeyQueued?.status, notes.journeyQueued?.delivery, notes.journeyQueued?.id !== null], [200, 'queued', true])
    if (liveChip !== null) {
      notes.journeyDelivered = await deliver({
        author: 'user', kind: 'message', target: liveChip.id, body: 'The walk says hello.',
        messageId: `walk-online-${stamp}`,
      })
      check('(y) a message to a reachable participant is delivered',
        [notes.journeyDelivered?.status, notes.journeyDelivered?.delivery], [200, 'delivered'])
    }

    // 3. An agent asks the person. The alert is recorded before any window
    // shows it, and the card counts it unread. Unread is what the person has
    // not looked at, so the journey starts away from the Studio: with the pane
    // on screen the view marks every arriving event read as it renders.
    if (await js(`return document.querySelector('[data-studio-pane]') !== null`)) {
      await js(`
        const handle = document.querySelector('[aria-label^="Chat actions for "]')
        const row = handle?.closest('div, li, a')
        const target = row?.querySelector('[class*="title"]') ?? row
        target?.click()
        return true`)
      await until(`document.querySelector('[data-studio-pane]') === null`, 15000)
    }
    notes.journeyStartedAwayFromStudio = await js(`return document.querySelector('[data-studio-pane]') === null`)
    check('(y) the journey starts with the Studio off screen, so unread means unread',
      notes.journeyStartedAwayFromStudio, true)
    const taskId = `walk-journey-${stamp}`
    await record({ author: liveChip?.id ?? 'walk-agent', kind: 'assignment', subtype: 'new-task', taskId, target: liveChip?.id ?? 'walk-agent', body: 'Run the pilot journey' })
    notes.journeyAsk = await record({
      author: liveChip?.id ?? 'walk-agent', kind: 'request', subtype: 'needs-input', taskId,
      target: 'user', body: 'Which font should the walk use?',
    })
    const askId = notes.journeyAsk?.id ?? null
    await wait(1500)
    const raised = await ledger()
    notes.journeyAlert = (raised.notifications ?? []).find(record => record.event === askId) ?? null
    check('(y) the request raised one alert, named by its MVP table row',
      [notes.journeyAlert?.row, notes.journeyAlert?.state], ['needs-input', 'sent'])
    // The card polls every 3s; unread is what the person has not looked at.
    notes.journeyUnreadMark = await untilValue(`document.querySelector('[data-studio-card-unread]')?.getAttribute('data-studio-card-unread')`, 15000)
    check('(y) the Studio card counts the unread ask', notes.journeyUnreadMark !== null, true)
    await shot('33-studio-card-unread')

    // 4. Opening the alert lands the Studio on that exact event.
    if (await js(`return document.querySelector('[data-studio-pane]') === null`)) {
      await clickSel('[data-studio-card]')
      await until(`document.querySelector('[data-studio-pane]')`, 30000)
    }
    await until(`document.querySelector('[data-studio-event-id="${askId}"]')`, 20000)
    await js(`document.dispatchEvent(new CustomEvent('idealize:open-studio', { detail: { studioEvent: ${JSON.stringify(askId)} } })); return true`)
    const landed = await until(`document.querySelector('[data-studio-focused]')?.getAttribute('data-studio-event-id') === ${JSON.stringify(askId)}`, 20000)
    notes.journeyRow = await js(`
      const row = document.querySelector('[data-studio-event-id="' + ${JSON.stringify(askId)} + '"]')
      const chip = row?.querySelector('[data-studio-resolution]') ?? null
      return { landed: row?.hasAttribute('data-studio-focused') ?? null, state: chip?.getAttribute('data-studio-resolution') ?? null, text: chip?.textContent?.trim() ?? null }`)
    check('(y) an opened alert lands the Studio on its exact event, still waiting',
      [landed, notes.journeyRow?.state, notes.journeyRow?.text], [true, 'open', 'Waiting for you'])
    await shot('34-studio-alert-opened')

    // 5. Reading the Studio clears the unread mark and resolves nothing.
    await wait(4000)
    notes.journeyAfterRead = await js(`
      const card = document.querySelector('[data-studio-card]')
      return { unread: card?.querySelector('[data-studio-card-unread]')?.textContent ?? null,
        attention: card?.querySelector('[data-studio-card-attention]')?.textContent ?? null }`)
    check('(y) reading the Studio clears the unread mark and leaves the attention count standing',
      [notes.journeyAfterRead?.unread, notes.journeyAfterRead?.attention !== null], [null, true])

    // 6. Dismissing the alert changes the alert's record and nothing else.
    notes.journeyDismiss = await post('/idealize/notify/attention/state', { event: askId, state: 'dismissed' })
    const afterDismiss = await studioState()
    notes.journeyStillOpen = (afterDismiss.tasks ?? []).find(task => task.id === taskId)?.attention ?? null
    check('(y) dismissing the alert leaves the unanswered request unanswered',
      [notes.journeyDismiss?.status, notes.journeyStillOpen], [200, 'needs-input'])

    // 7. A forced interruption of the pane's own reads: the cause is stated,
    // the stale view stays, and nothing recorded is lost.
    await js(`
      window.__walkCut = true
      if (window.__walkPatchedFetch !== true) {
        window.__walkPatchedFetch = true
        const real = window.fetch.bind(window)
        window.fetch = (input, init) => {
          const url = String(typeof input === 'string' ? input : (input?.url ?? ''))
          if (window.__walkCut === true && url.includes('/idealize/studio/overview')) {
            return Promise.resolve(new Response('cut', { status: 503 }))
          }
          return real(input, init)
        }
      }
      return true`)
    const stated = await until(`document.querySelector('[data-studio-error]')`, 20000)
    notes.journeyCut = await js(`
      const pane = document.querySelector('[data-studio-pane]')
      return { cause: document.querySelector('[data-studio-error]')?.textContent ?? null,
        retry: [...(pane?.querySelectorAll('button') ?? [])].some(b => (b.textContent ?? '').trim() === 'Retry'),
        stillShowing: document.querySelector('[data-studio-event-id="' + ${JSON.stringify(askId)} + '"]') !== null }`)
    check('(y) a cut to the pane states its cause, offers Retry, and keeps the record on screen',
      [stated, /503/.test(notes.journeyCut?.cause ?? ''), notes.journeyCut?.retry, notes.journeyCut?.stillShowing],
      [true, true, true, true])
    await shot('35-studio-cut')
    await js(`window.__walkCut = false; return true`)
    const recovered = await until(`document.querySelector('[data-studio-error]') === null`, 30000)
    const afterCut = await ledger()
    notes.journeyAfterCut = {
      alert: (afterCut.notifications ?? []).find(record => record.event === askId)?.state ?? null,
      queued: (await studioState()).deliveries?.[notes.journeyQueued?.id ?? ''] ?? null,
    }
    check('(y) the pane recovers and nothing recorded was lost across the cut',
      [recovered, notes.journeyAfterCut.alert, notes.journeyAfterCut.queued], [true, 'dismissed', 'queued'])

    // 8. The answer is the only thing that resolves the ask, and the row says so.
    notes.journeyAnswer = await post('/idealize/studio/event', {
      project: PROJECT, author: 'user', kind: 'system', subtype: 'resolve-request', taskId, source: { event: askId },
    })
    const answered = await until(`document.querySelector('[data-studio-event-id="' + ${JSON.stringify(askId)} + '"] [data-studio-resolution]')?.getAttribute('data-studio-resolution') === 'answered'`, 20000)
    notes.journeyResolved = (await studioState()).tasks?.find(task => task.id === taskId)?.attention ?? null
    check('(y) answering the request is what resolves it, and the row shows the answer',
      [notes.journeyAnswer?.status, answered, notes.journeyResolved], [200, true, 'none'])
    await shot('36-studio-answered')
  }
}

const report = { ok: failures.length === 0, failures, notes }
writeFileSync(join(OUT, 'real-walk.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
