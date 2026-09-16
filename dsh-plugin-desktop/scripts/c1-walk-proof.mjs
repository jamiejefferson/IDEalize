// Wave C1 walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9333, then: node c1-walk-proof.mjs <out-dir> [port].
// Reads every state off the DOM and its computed styles; never sends a message.
// Sections: (a) rail order and glyphs, (b) the mini-mode toggle in the sidebar
// header, (c) session card hierarchy and hover card, (d) the rule between
// projects, (e) the Session log control, (f) the terminal grid's right edge,
// (g) the Service hatch opening bubble and no "Open as a chat", (h) Brains row
// titles and the Project leadership table.
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
  const r = await send('Runtime.evaluate', { expression: `(() => { ${expr} })()`, returnByValue: true, awaitPromise: true })
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

// Settle (isolated copy only).
await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(7000)
notes.onboardingWizard = await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)
if (notes.onboardingWizard) {
  await clickSel('[data-onboarding-skip-all]')
  await wait(2500)
  for (let i = 0; i < 3 && await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`); i += 1) {
    await clickLabel('/^(Continue|Done|Finish|Close)$/i'); await wait(2000)
  }
}
notes.mode = await js(`return new URL(location.href).searchParams.get('dsh-desktop-mode')`)
check('boots in compatibility mode', notes.mode, 'compatibility')
await shot('00-landed')

// (a) the rail: order and glyphs
notes.rail = await js(`return [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].map(e => (e.getAttribute('aria-label') ?? '').trim())`)
check('(a) rail order', notes.rail.filter(l => l !== 'Plugins'), ['Files', 'Schedule', 'Trajectory', 'Brains', 'Appearance', 'Feedback', 'Service hatch'])
check('(a) the rail carries no Mini mode entry', notes.rail.includes('Mini mode'), false)
notes.railGlyphs = await js(`
  return [...document.querySelectorAll('nav[aria-label="Tool rail"] button')].map(e => ({ label: e.getAttribute('aria-label'), paths: e.querySelectorAll('svg path, svg circle').length, svg: e.querySelector('svg') !== null }))`)
check('(a) every rail entry draws a glyph', notes.railGlyphs.every(g => g.svg), true)
await shot('01-rail')

// (b) the mini-mode toggle sits in the sidebar header under New chat
notes.minimode = await js(`
  const b = [...document.querySelectorAll('button')].find(e => /^(Mini mode|Exit mini mode)$/.test(e.getAttribute('aria-label') ?? ''))
  if (!b) return null
  const rail = document.querySelector('nav[aria-label="Tool rail"]')
  const toggle = [...document.querySelectorAll('button')].find(e => /^(Collapse|Open) sidebar$|sidebar/i.test(e.getAttribute('aria-label') ?? '') && e.closest('nav[aria-label="Tool rail"]') === null)
  const r = b.getBoundingClientRect(); const n = toggle?.getBoundingClientRect()
  const header = b.closest('[class*="logoRow"]'); const hr = header?.getBoundingClientRect()
  return { inRail: rail !== null && rail.contains(b), pressed: b.getAttribute('aria-pressed'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    toggleLabel: toggle?.getAttribute('aria-label') ?? null,
    onToggleRow: n !== undefined && Math.abs(r.top - n.top) <= 2 && r.right <= n.left + 2,
    unclipped: hr !== undefined && r.bottom <= hr.bottom + 0.5 && r.top >= hr.top - 0.5 }`)
check('(b) a Mini mode toggle exists outside the rail', notes.minimode !== null && notes.minimode.inRail === false, true)
check('(b) the toggle is not pressed in compatibility mode', notes.minimode?.pressed, 'false')
check('(b) the toggle sits on the collapse toggle\'s row, left of it', notes.minimode?.onToggleRow, true)
check('(b) the toggle is not clipped by the header row', notes.minimode?.unclipped, true)
check('(b) the toggle is square and at least 24px', notes.minimode !== null && notes.minimode.w === notes.minimode.h && notes.minimode.w >= 24, true)
await shot('02-sidebar-header')

// (c) session cards: eyebrow name over the dominant summary; hover card carries summary + space
notes.cards = await js(`
  const rows = [...document.querySelectorAll('[aria-label^="Chat actions for "]')].map(h => h.closest('[role="treeitem"]')).filter(Boolean)
  return rows.map(row => {
    const spans = [...row.querySelectorAll('span')]
    const name = spans.find(s => s.className.includes('agentName')); const task = spans.find(s => s.className.includes('task'))
    if (!name || !task) return null
    const cs = e => getComputedStyle(e)
    return { name: name.textContent.trim(), task: task.textContent.trim(), nameSize: parseFloat(cs(name).fontSize), taskSize: parseFloat(cs(task).fontSize),
      nameAbove: name.getBoundingClientRect().top < task.getBoundingClientRect().top, nameColor: cs(name).color, taskColor: cs(task).color }
  }).filter(Boolean)`)
check('(c) named cards exist', notes.cards.length > 0, true)
check('(c) the summary is larger than the name on every named card', notes.cards.every(c => c.taskSize > c.nameSize), true)
check('(c) the name sits above the summary as an eyebrow', notes.cards.every(c => c.nameAbove), true)
// Hover card: dwell on the first named row.
notes.hoverTarget = await js(`
  const h = [...document.querySelectorAll('[aria-label^="Chat actions for "]')][0]
  const row = h?.closest('[role="treeitem"]'); if (!row) return null
  const r = row.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }`)
if (notes.hoverTarget !== null) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: notes.hoverTarget.x - 30, y: notes.hoverTarget.y })
  await wait(200)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: notes.hoverTarget.x, y: notes.hoverTarget.y })
}
await wait(1200)
notes.hoverCard = await js(`
  const cards = [...document.querySelectorAll('[class*="hoverContent"]')]
  const c = cards.at(-1); if (!c) return null
  const eyebrow = c.querySelector('[class*="hoverEyebrow"]')
  return { lines: [...c.children].map(e => e.textContent.trim()), eyebrow: eyebrow?.textContent.trim() ?? null,
    space: [...c.children].some(e => /^(Chat|Terminal|Gallery|Sound Stage|Motion)$/.test(e.textContent.trim())) }`)
check('(c) the hover card shows the chat\'s space', notes.hoverCard?.space, true)
check('(c) the hover card leads with the agent name as an eyebrow', notes.hoverCard !== null && notes.hoverCard.eyebrow !== null, true)
await shot('03-hover-card')
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 400 })

// (d) a rule between project groups
notes.groupRule = await js(`
  const groups = [...document.querySelectorAll('[class*="groupSection"]')]
  if (groups.length < 2) return { groups: groups.length }
  const cs = getComputedStyle(groups[1])
  return { groups: groups.length, borderTop: cs.borderTopWidth, style: cs.borderTopStyle, paddingTop: cs.paddingTop, marginTop: cs.marginTop }`)
// The sidebar surface is scaled by the appearance settings, so the hairline reads as a fraction of a CSS px.
check('(d) a hairline rule separates project groups', parseFloat(notes.groupRule.borderTop ?? '0') > 0 && notes.groupRule.style === 'solid', true)
await shot('04-project-rule')

// (e) open a started chat: the Session log control is a 24px icon button
// A chat with turns: the header (and its Session log action) hides on a chat
// that has never been sent to, so prefer a row whose card carries a summary.
const openStarted = await js(`
  const rows = [...document.querySelectorAll('[aria-label^="Chat actions for "]')].map(h => h.closest('[role="treeitem"]')).filter(Boolean)
  const row = rows.find(r => /hi there|an owl|owl song|hei/.test(r.textContent)) ?? rows[0]; if (!row) return false
  row.click(); return true`)
await wait(5000)
notes.sessionLog = await js(`
  const b = [...document.querySelectorAll('button')].find(e => e.getAttribute('aria-label') === 'Session log')
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height), text: b.textContent.trim(), hasIcon: b.querySelector('svg') !== null, border: getComputedStyle(b).borderTopWidth }`)
check('(e) the Session log control is icon-only', [notes.sessionLog?.text, notes.sessionLog?.hasIcon], ['', true])
check('(e) the Session log control is a small square, not the 111×32 capsule', notes.sessionLog !== null && notes.sessionLog.w === notes.sessionLog.h && notes.sessionLog.w <= 28, true)
await shot('05-session-log')

// (f) terminal: the grid reaches the paint margin on both sides
const newChatIn = async (project) => {
  await clickLabel(`/^New chat in ${project}$/i`)
  const ok = await until(`document.querySelector('[data-launcher-step="space"]')`, 20000)
  await wait(1500)
  return ok
}
notes.chooserForTerminal = await newChatIn('idealize')
await clickSel('[data-launcher-step="space"] [data-space="terminal"]')
await until(`document.querySelector('[data-launcher-step="brain"]')`)
await clickSel('[data-launcher-step="brain"] [data-brain="coding"]')
const terminalUp = await until(`document.querySelector('[data-testid="idealize-terminal"] .xterm-screen')`, 45000)
await wait(4000)
notes.terminal = await js(`
  const root = document.querySelector('[data-testid="idealize-terminal"]'); if (!root) return null
  const grid = root.firstElementChild; const vp = root.querySelector('.xterm-viewport'); const screen = root.querySelector('.xterm-screen')
  const r = e => e.getBoundingClientRect()
  const pad = getComputedStyle(grid)
  return { leftGap: Math.round(r(screen).left - r(root).left), rightGap: Math.round(r(root).right - r(screen).right), padLeft: pad.paddingLeft, padRight: pad.paddingRight,
    viewportScreenDelta: Math.round(r(vp).right - r(screen).right), scrollbarWidth: getComputedStyle(vp).scrollbarWidth }`)
check('(f) the terminal spawned', terminalUp, true)
// The right gap may exceed the left by the fit remainder (< one cell), never by a gutter.
check('(f) the right margin is within one cell of the left', notes.terminal !== null && notes.terminal.rightGap - notes.terminal.leftGap < 12, true)
await shot('06-terminal')

// (g) the Service hatch: opening bubble, no "Open as a chat"
await railButton('/^Service hatch$/')
await wait(3000)
notes.hatch = await js(`
  const header = [...document.querySelectorAll('header')].find(h => /Service Hatch Open/i.test(h.textContent))
  const cs = header ? getComputedStyle(header) : null
  return { header: header !== undefined, radius: cs?.borderTopRightRadius ?? null, background: cs?.backgroundColor ?? null,
    openAsChat: [...document.querySelectorAll('button')].some(b => /^Open as a chat$/.test(b.textContent.trim())),
    sendButton: [...document.querySelectorAll('button')].some(b => /^Send$/.test(b.textContent.trim())) }`)
check('(g) the hatch opening copy renders', notes.hatch.header, true)
check('(g) the opening copy is a rounded bubble', notes.hatch.radius, '12px')
check('(g) no Open as a chat button', notes.hatch.openAsChat, false)
await shot('07-service-hatch')
await clickLabel('/^Close panel$/i'); await wait(1000)

// (h) Brains: media rows titled by what they make; Project leadership table
await railButton('/^Brains$/')
await until(`document.querySelector('[role="table"]')`, 15000)
await wait(3000)
notes.brains = await js(`
  const tables = [...document.querySelectorAll('[role="table"]')].map(t => t.getAttribute('aria-label'))
  const firstCells = [...document.querySelectorAll('[role="row"] > span:first-child')].map(e => e.textContent.trim())
  return { tables, media: firstCells.filter(c => /^(Images|Sounds|Video|Gallery|Sound Stage|Motion)$/.test(c)) }`)
check('(h) the leadership table is titled Project leadership', notes.brains.tables.includes('Project leadership') && !notes.brains.tables.includes('Roles'), true)
check('(h) media rows read Images, Sounds, Video', notes.brains.media.filter(c => /^(Images|Sounds|Video)$/.test(c)).sort(), ['Images', 'Sounds', 'Video'])
await shot('08-brains')
await clickLabel('/^Close panel$/i')

writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => typeof notes[k] === 'string' && /^(PASS|FAIL)/.test(notes[k])).length }))
for (const f of failures) console.log('FAIL', f.name, JSON.stringify(f.actual), '!=', JSON.stringify(f.expected))
ws.close()
process.exit(failures.length === 0 ? 0 : 2)
