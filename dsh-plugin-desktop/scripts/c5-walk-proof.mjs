// Wave C5 walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9334, then: node c5-walk-proof.mjs <out-dir> [port].
// The Schedule pane against the "calendar wires" frame: (a) the Day lane is the
// default with an ALL DAY row and hour blocks; (b) a real mouse drag moves a
// block a half hour later and the cron document agrees; (c) a tap on an empty
// slot seeds Create-with-chat at that half hour; (d) the Week grid sits behind
// its tab. The two tasks the walk creates are disabled (nothing fires) and are
// deleted at the end.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const OUT = process.argv[2]
const PORT = process.argv[3] ?? '9334'
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
const HEADERS = `{ 'x-idealize-auth': '1', 'content-type': 'application/json' }`

await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(6000)
if (await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)) { await js(`document.querySelector('[data-onboarding-skip-all]').click()`); await wait(2500) }

// Two disabled tasks in the scratch cron document: a timed weekly one on today's weekday at 10:00, an interval one for ALL DAY.
const zone = await js(`return Intl.DateTimeFormat().resolvedOptions().timeZone`)
const today = new Date().getDay()
const created = await js(`
  const post = body => fetch('/idealize/cron/tasks', { method: 'POST', headers: ${HEADERS}, body: JSON.stringify(body) }).then(r => r.json())
  const timed = await post({ name: 'C5 walk brief', schedule: { kind: 'weekly', at: '10:00', timeZone: ${JSON.stringify(zone)}, days: [${today}] }, prompt: 'Proof only.', cwd: '/tmp', enabled: false })
  const interval = await post({ name: 'C5 walk watcher', schedule: { kind: 'every', seconds: 86400 }, prompt: 'Proof only.', cwd: '/tmp', enabled: false })
  return { timed: timed.id, interval: interval.id }`)
notes.created = created

try {
  // Open the pane (a second press if the first only closed a drawer left open), and leave any open sub-state.
  await railButton('/^Schedule$/')
  if (!await until(`document.querySelector('[data-schedule-view], button[aria-label="Back to calendar"]')`, 4000)) await railButton('/^Schedule$/')
  await until(`document.querySelector('[data-schedule-view], button[aria-label="Back to calendar"]')`, 15000)
  if (await js(`const b = document.querySelector('button[aria-label="Back to calendar"]'); if (b) { b.click(); return true } return false`)) await wait(600)
  await until(`document.querySelector('[data-schedule-view]')`, 15000)
  await until(`document.querySelector('[data-schedule-task=' + JSON.stringify(${JSON.stringify(created.timed)}) + ']')`, 15000)
  await wait(1200)
  notes.day = await js(`
    const tab = document.querySelector('[role="tab"][aria-selected="true"]')
    const block = document.querySelector('[data-schedule-lane] [data-schedule-task=' + JSON.stringify(${JSON.stringify(created.timed)}) + ']')
    return { tab: tab?.textContent, grain: document.querySelector('[data-schedule-view]').getAttribute('data-schedule-grain'),
      allDay: [...document.querySelectorAll('[data-schedule-allday] [data-schedule-task]')].map(e => e.textContent),
      block: block?.textContent ?? null, today: document.querySelector('[data-schedule-view] button[aria-pressed="true"]')?.textContent }`)
  check('(a) the pane opens on the Day tab', notes.day.tab, 'Day')
  check('(a) the interval task sits in the ALL DAY row', notes.day.allDay.some(text => text.includes('C5 walk watcher')), true)
  check('(a) the timed task is a block on the hour lane with its detail line', notes.day.block !== null && notes.day.block.includes('10:00') && notes.day.block.includes('tmp'), true)
  await shot('00-day-lane')

  // (b) drag the block 36px down: half an hour later on the 72px hour.
  const rect = await js(`const r = document.querySelector('[data-schedule-lane] [data-schedule-task=' + JSON.stringify(${JSON.stringify(created.timed)}) + ']').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
  await mouse('mouseMoved', rect.x, rect.y); await mouse('mousePressed', rect.x, rect.y, { clickCount: 1 })
  for (let i = 1; i <= 6; i += 1) { await mouse('mouseMoved', rect.x, rect.y + 6 * i); await wait(40) }
  notes.subtitleDuringDrag = await js(`return [...document.querySelectorAll('[data-schedule-view] p')].map(p => p.textContent).find(t => t.includes('Drag'))`)
  await mouse('mouseReleased', rect.x, rect.y + 36, { clickCount: 1 })
  await until(`document.querySelector('[data-schedule-view] [role="status"]')`, 10000)
  await wait(800)
  notes.moved = await js(`return document.querySelector('[data-schedule-view] [role="status"]')?.textContent`)
  notes.storedAt = await js(`const tasks = await (await fetch('/idealize/cron/tasks')).json(); return tasks.find(t => t.id === ${JSON.stringify(created.timed)})?.schedule.at`)
  check('(b) the subtitle reads the Reschedule frame while the drag is live', notes.subtitleDuringDrag, 'Drag a task to change its schedule.')
  check('(b) the release reports the new time', notes.moved, 'C5 walk brief moved to 10:30')
  check('(b) the cron document carries the new time', notes.storedAt, '10:30')
  check('(b) the drag did not open the editor', await js(`return document.querySelector('[data-schedule-view] h2')?.textContent`), 'Schedule')
  await shot('01-rescheduled')

  // (c) a tap on an empty slot: 08:30, above the moved block and inside the visible lane.
  const lane = await js(`const el = document.querySelector('[data-schedule-lane] [role="group"]'); const r = el.getBoundingClientRect(); const start = Number(el.parentElement.querySelector('span').textContent.slice(0, 2)); return { x: r.x + r.width - 30, top: r.y, start }`)
  const tapY = lane.top + (8.5 - lane.start) * 72
  await mouse('mouseMoved', lane.x, tapY); await mouse('mousePressed', lane.x, tapY, { clickCount: 1 }); await mouse('mouseReleased', lane.x, tapY, { clickCount: 1 })
  // The Create state is its own section (no data-schedule-view), so read the headings of the drawer at large.
  await until(`[...document.querySelectorAll('h2')].some(h => h.textContent === 'New scheduled task')`, 8000)
  notes.tap = await js(`return { heading: [...document.querySelectorAll('h2')].map(h => h.textContent).find(t => t === 'New scheduled task') ?? null, slot: [...document.querySelectorAll('p')].map(p => p.textContent).find(t => t.startsWith('Planned for')) ?? null }`)
  check('(c) the tap opens Create-with-chat', notes.tap.heading, 'New scheduled task')
  check('(c) seeded with the tapped half hour', /at 08:30/.test(notes.tap.slot ?? ''), true)
  await shot('02-tap-create')
  await js(`document.querySelector('button[aria-label="Back to calendar"]').click()`)
  await wait(600)

  // (d) the Week grid behind its tab.
  await js(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Week').click()`)
  await wait(800)
  notes.week = await js(`return { grain: document.querySelector('[data-schedule-view]').getAttribute('data-schedule-grain'), columns: [...document.querySelectorAll('[data-schedule-view] div')].find(n => getComputedStyle(n).gridTemplateColumns.split(' ').length === 7)?.children.length, item: document.querySelector('[data-schedule-task=' + JSON.stringify(${JSON.stringify(created.timed)}) + ']')?.textContent }`)
  check('(d) the Week tab shows seven columns', notes.week.columns, 7)
  check('(d) the moved task reads 10:30 in its column', (notes.week.item ?? '').includes('10:30'), true)
  await shot('03-week')
  await js(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Day').click()`)
} finally {
  notes.cleanup = await js(`
    const del = id => fetch('/idealize/cron/delete?id=' + encodeURIComponent(id), { method: 'POST', headers: ${HEADERS} }).then(r => r.status)
    return [await del(${JSON.stringify(created.timed)}), await del(${JSON.stringify(created.interval)})]`)
}
writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => k.startsWith('(')).length }))
if (failures.length > 0) console.log(JSON.stringify(failures, null, 2))
ws.close()
process.exit(failures.length > 0 ? 1 : 0)
