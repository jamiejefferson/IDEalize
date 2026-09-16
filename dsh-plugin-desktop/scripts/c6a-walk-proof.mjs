// Wave C6a walk of the REAL packaged IDEalize V1 window, over its CDP port.
// Launch the packaged binary with --user-data-dir=<scratch copy> and
// --remote-debugging-port=9335, then: node c6a-walk-proof.mjs <out-dir> [port].
// The Brains pane names which brains run as a CLI in the terminal: (a) the
// agents route reports the terminal CLI and its install state; (b) a brain on
// that route carries the terminal note and no Add key; (c) its picker groups
// carry the mark; (d) Subscriptions lists the CLI and Token Use does not list
// the keyless route. The walk creates one brain on Anthropic in the scratch
// roster (the agents route has no delete; the scratch copy is discarded).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const OUT = process.argv[2]
const PORT = process.argv[3] ?? '9335'
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
const HEADERS = `{ 'x-idealize-auth': '1', 'content-type': 'application/json' }`

await until(`document.querySelector('[data-launcher-step], [aria-label^="Chat actions for "]')`, 60000)
await wait(6000)
if (await js(`return document.querySelector('[data-onboarding-skip-all]') !== null`)) { await js(`document.querySelector('[data-onboarding-skip-all]').click()`); await wait(2500) }

// (a) the route
notes.route = await js(`const r = await (await fetch('/idealize/activity/agents')).json(); return { terminal: r.terminal, anthropicModels: (await (await fetch('/idealize/models/state')).json()).providers.find(p => p.provider === 'anthropic')?.models?.length ?? 0 }`)
check('(a) the agents route names the terminal CLI for Anthropic', notes.route.terminal?.[0]?.provider === 'anthropic' && notes.route.terminal?.[0]?.cli === 'claude', true)
check('(a) and says whether the login shell finds it', typeof notes.route.terminal?.[0]?.installed, 'boolean')

// a brain on Anthropic, in the scratch roster only
const brain = await js(`const r = await fetch('/idealize/activity/agent', { method: 'POST', headers: ${HEADERS}, body: JSON.stringify({ name: 'C6a walk writer', model: { provider: 'anthropic', model: 'claude-opus-5' }, instructions: 'Proof only.', spaces: ['chat'] }) }); return await r.json()`)
notes.brain = brain
try {
  await railButton('/^Brains$/')
  await until(`document.querySelector('[data-brain="c6a-walk-writer"]')`, 15000)
  await wait(1000)
  notes.row = await js(`const row = document.querySelector('[data-brain="c6a-walk-writer"]'); const note = row.querySelector('[data-brain-access]'); return { access: note?.getAttribute('data-brain-access') ?? null, text: note?.textContent ?? null, buttons: note ? note.querySelectorAll('button').length : -1, groups: [...row.querySelectorAll('optgroup')].map(g => g.label) }`)
  check('(b) the brain carries the terminal note', notes.row.access, 'terminal-only')
  check('(b) the note names the CLI and offers the chat key', notes.row.text?.startsWith('Runs as the claude CLI in the terminal, on its subscription. Chat needs an API key.') === true && notes.row.buttons === 1, true)
  // The picker groups a provider only when its model list is configured; this install has none for Anthropic.
  if (notes.route.anthropicModels > 0) check('(c) its picker groups mark Anthropic as the CLI', notes.row.groups.some(l => l === 'Anthropic · claude CLI in the terminal'), true)
  else notes['(c) picker group'] = 'not checked: Anthropic has no configured model list in this install, so no group renders'
  await shot('00-brain-row')
  await js(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Models').click()`)
  await wait(800)
  notes.models = await js(`const cli = document.querySelector('[data-terminal-cli="claude"]'); const rows = [...document.querySelectorAll('[class*="providerRow"]')].map(r => r.textContent); return { cli: cli?.textContent ?? null, rows }`)
  check('(d) Subscriptions lists the CLI with its install state', notes.models.cli !== null && /Installed|Not found on this Mac|Could not check/.test(notes.models.cli), true)
  check('(d) and offers the chat key path', /Add key for chat|Manage/.test(notes.models.cli ?? ''), true)
  check('(d) Token Use does not list Anthropic as a missing key', notes.models.rows.filter(r => r.includes('Anthropic')).length, 1)
  await shot('01-models-tab')

  // (e) the Terminal group's CLI choice: pickers over the catalogue, a Default
  // CLI row, and a write that persists — then put back.
  await js(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Usage').click()`)
  await until(`document.querySelector('[data-terminal-default-cli] select')`, 10000)
  notes.cli = await js(`
    const terminal = document.querySelector('[data-brains-space="terminal"]')
    const fallback = terminal.querySelector('[data-terminal-default-cli] select')
    const rows = [...terminal.querySelectorAll('[data-brain] select')]
    return { fallbackValue: fallback.value, options: [...fallback.options].map(o => o.textContent), rowSelects: rows.length }`)
  check('(e) the Default CLI row offers the catalogue', notes.cli.options.some(o => o === 'Claude Code') && notes.cli.options.some(o => o === 'Codex CLI'), true)
  check('(e) every Terminal brain row carries a CLI picker', notes.cli.rowSelects > 0, true)
  await shot('02-terminal-clis')
  const before = await js(`return (await (await fetch('/idealize/terminal/launches')).json()).default`)
  await js(`
    const el = document.querySelector('[data-terminal-default-cli] select')
    const pick = [...el.options].find(o => o.value === 'cli:codex')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(el, pick.value); el.dispatchEvent(new Event('change', { bubbles: true }))`)
  await wait(1200)
  notes.cliWritten = await js(`return (await (await fetch('/idealize/terminal/launches')).json()).default`)
  check('(f) choosing Codex CLI persists as the default launch', notes.cliWritten, 'codex')
  await js(`
    const el = document.querySelector('[data-terminal-default-cli] select')
    const pick = [...el.options].find(o => o.value === 'cli:claude-code')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(el, pick.value); el.dispatchEvent(new Event('change', { bubbles: true }))`)
  await wait(1200)
  notes.cliRestored = await js(`return (await (await fetch('/idealize/terminal/launches')).json()).default`)
  check('(f) and the walk puts the default back', notes.cliRestored === before, true)
} finally {
  notes.cleanup = 'the walk brain stays in the scratch roster; no delete route exists'
}
writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ failures, notes }, null, 2))
console.log(JSON.stringify({ failures: failures.length, checks: Object.keys(notes).filter(k => k.startsWith('(')).length }))
if (failures.length > 0) console.log(JSON.stringify(failures, null, 2))
ws.close()
process.exit(failures.length > 0 ? 1 : 0)
