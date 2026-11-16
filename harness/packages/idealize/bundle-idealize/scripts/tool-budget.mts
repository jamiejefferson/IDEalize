/**
 * Tool budget report (not a vitest spec): boot the whole `idealize` profile in
 * this process, start one chat for each launchable space and each brain the
 * space offers, and print how many tools the chat's request carries and how
 * many characters their schemas take.
 *
 * What is measured. Each chat is made the way the browser makes one:
 * `session.create` with the brain's agent preset, then
 * `POST /idealize/spaces/select` with the space. The tools are read from
 * `ctx.systemPrompt.assemble({ scope: agent })`, the same assembly the agent
 * loop sends, so prompt-assembly listeners and per-agent restrictions count.
 * Schema characters are the summed length of `JSON.stringify({ name,
 * description, parameters })` over those tools. A provider adapter adds its own
 * wrapper around each one (for example `{"type":"function","function":…}`),
 * which this figure leaves out because it differs per provider.
 *
 * What is left out. The two MCP client rows (`idealize-mcp-paper`,
 * `idealize-mcp-hatch`) are disabled by an overlay patch: their tool lists
 * come from apps installed on the machine, so they vary per person, and the
 * Hatch row would start the launcher inside the installed Hatch app. In the
 * shipped app both rows sit on the host plane, so every chat's request also
 * carries whatever those two servers publish. No other row is changed.
 *
 * Isolation. `HOME` and `DSH_HOME` point inside a temporary folder that is
 * deleted at the end, every inherited key, token and `IDEALIZE_*` / `DSH_*`
 * variable is dropped before the app loads, and `fetch` refuses every address
 * except this machine's loopback. The app listens on a loopback port the
 * operating system picks, and no window opens.
 *
 * Needs a built tree, because the profile serves the browser bundles from each
 * package's `lib/`:
 *
 *   corepack pnpm run build
 *   node --import tsx/esm packages/idealize/bundle-idealize/scripts/tool-budget.mts
 *
 * `--names` also lists the tool names of each distinct tool set.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** One tool as the prompt assembly carries it. */
interface WireTool {
  name: string
  description?: string
  parameters?: unknown
}

/** One measured chat. */
interface Row {
  space: string
  brain: string
  preset: string
  tools: WireTool[]
  chars: number
}

/** The count past which a composition needs a recommendation (the scope's threshold). */
const BUDGET = 30

// ── Isolation, in place before any app module loads ─────────────────────────
const scratch = await mkdtemp(join(tmpdir(), 'idealize-tool-budget-'))
for (const key of Object.keys(process.env)) {
  if (/(_KEY|_TOKEN|_SECRET|_BASE_URL)$|^(IDEALIZE|DSH|HATCH)_/.test(key)) delete process.env[key]
}
const home = join(scratch, 'home')
const dshHome = join(scratch, 'dsh-home')
const project = join(scratch, 'project')
Object.assign(process.env, {
  HOME: home,
  DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local', 'share'),
  DSH_TELEMETRY_DISABLED: '1',
  IDEALIZE_SKIP_TOUR: '1',
})
for (const dir of [home, dshHome, project]) {
  if (!resolve(dir).startsWith(resolve(scratch))) throw new Error(`${dir} is not inside the scratch folder`)
  await mkdir(dir, { recursive: true })
}
process.chdir(project)

const refused = new Set<string>()
const loopbackFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return await loopbackFetch(input, init)
  refused.add(url.host)
  throw new TypeError(`tool-budget: request to ${url.host} refused, the report runs without the network`)
}) as typeof fetch

const overlay = join(scratch, 'tool-budget.patch.yml')
await writeFile(overlay, '- id: idealize-mcp-paper\n  disabled: true\n- id: idealize-mcp-hatch\n  disabled: true\n')

// ── Boot the shipped profile ────────────────────────────────────────────────
const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
const { SessionId } = await import('@deepseek-ai/dsh-session')
const { runProfile } = await import('../../../../apps/cli/src/profile-boot.ts')

// The app prints its own start-up lines on stdout; the report is the only
// thing this script writes there, so those lines go to stderr instead.
const stdoutWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write
const { ctx } = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'idealize',
  patchFiles: [overlay],
  args: ['--host', '127.0.0.1', '--port', '0'],
})
const base = `http://127.0.0.1:${String(ctx.webServer.port)}`

/** One call on the app's own RPC channel, returning the reply's value. */
async function rpc(method: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await loopbackFetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} failed: ${String(response.status)} ${text.slice(0, 300)}`)
  const reply = JSON.parse(text) as { result?: { value?: Record<string, unknown> } }
  if (reply.result?.value === undefined) throw new Error(`${method} gave no value: ${text.slice(0, 300)}`)
  return reply.result.value
}

/** What `GET /idealize/spaces` serves for one space. */
interface RosterEntry {
  id: string
  brains: { id: string; name: string }[]
}

/** The launchable spaces and the brains each offers, as the welcome card reads them. */
async function roster(): Promise<RosterEntry[]> {
  const response = await loopbackFetch(`${base}/idealize/spaces`)
  if (!response.ok) throw new Error(`the roster route answered ${String(response.status)}`)
  return (await response.json() as { spaces: RosterEntry[] }).spaces
}

// The brains are seeded after the app starts listening. Wait until four reads
// a quarter of a second apart agree, and every space has had the chance to fill.
let spaces = await roster()
for (let same = 0, tries = 0; same < 4; tries += 1) {
  if (tries > 240) throw new Error('the brain roster never settled')
  await new Promise((settle) => { setTimeout(settle, 250) })
  const next = await roster()
  same = JSON.stringify(next) === JSON.stringify(spaces) && next.some(space => space.brains.length > 0) ? same + 1 : 0
  spaces = next
}

await rpc('workspace.create', { path: project })

/**
 * Start a chat on one preset and read the tools its request carries.
 * @param preset - the agent preset id.
 * @param space - the space to record on the chat, when the chat is launched into one.
 * @returns the tools and their summed schema characters.
 */
async function measure(preset: string, space?: string): Promise<{ tools: WireTool[]; chars: number }> {
  const created = await rpc('session.create', { cwd: project, agentPreset: preset })
  const sessionId = String(created.sessionId)
  if (space !== undefined) {
    const selected = await loopbackFetch(`${base}/idealize/spaces/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ sessionId, space, brain: preset }),
    })
    if (!selected.ok) throw new Error(`recording ${space} on a ${preset} chat answered ${String(selected.status)}`)
  }
  const agent = ctx.agents.get(SessionId(sessionId))
  if (agent === undefined) throw new Error(`no live agent for the ${preset} chat`)
  const assembly = await ctx.systemPrompt.assemble({ scope: agent })
  const tools = assembly.tools.map(({ name, description, parameters }): WireTool => ({ name, description, parameters }))
  return { tools, chars: tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0) }
}

const rows: Row[] = []
for (const space of spaces) {
  for (const brain of space.brains) {
    rows.push({ space: space.id, brain: brain.name, preset: brain.id, ...await measure(brain.id, space.id) })
  }
}
const offered = new Set(rows.map(row => row.preset))
const others: Row[] = []
for (const preset of await ctx.agentPresets.list()) {
  if (offered.has(preset.id) || preset.broken !== undefined) continue
  others.push({ space: '', brain: preset.trust, preset: preset.id, ...await measure(preset.id) })
}
const hostTools = ctx.tools.schemas().map(tool => tool.name).sort()

// ── The report ──────────────────────────────────────────────────────────────
const out: string[] = []
const figure = (value: number): string => value.toLocaleString('en-GB')
const over = (row: Row): string => row.tools.length > BUDGET ? 'yes' : 'no'

out.push(`Launchable spaces and their brains (${String(rows.length)} compositions; Paper's and Hatch's MCP tools not counted):`, '')
out.push(`| Space | Brain | Preset | Tools | Schema characters | Over ${String(BUDGET)} | Reaches a model |`)
out.push('|---|---|---|---:|---:|---|---|')
for (const row of rows) {
  // A Terminal chat never sends a prompt: the shell launches a command-line
  // agent that brings its own tools (`@idealize/ui-terminal`'s README).
  const reaches = row.space === 'terminal' ? 'no, the terminal CLI uses its own tools' : 'yes'
  out.push(`| ${row.space} | ${row.brain} | \`${row.preset}\` | ${String(row.tools.length)} | ${figure(row.chars)} | ${over(row)} | ${reaches} |`)
}
out.push('', 'Presets no space offers:', '')
out.push(`| Preset | Root | Tools | Schema characters | Over ${String(BUDGET)} |`, '|---|---|---:|---:|---|')
for (const row of others) {
  out.push(`| \`${row.preset}\` | ${row.brain} | ${String(row.tools.length)} | ${figure(row.chars)} | ${over(row)} |`)
}
out.push('', `Tools every chat carries from the host plane (${String(hostTools.length)}): ${hostTools.join(', ')}.`)

if (process.argv.includes('--names')) {
  const sets = new Map<string, string[]>()
  for (const row of [...rows, ...others]) {
    const names = row.tools.map(tool => tool.name).sort().join(', ')
    sets.set(names, [...sets.get(names) ?? [], row.preset])
  }
  out.push('', 'Distinct tool sets:', '')
  for (const [names, presets] of sets) {
    out.push(`- ${[...new Set(presets)].map(id => `\`${id}\``).join(', ')} (${String(names.split(', ').length)}): ${names}`)
  }
}

stdoutWrite(`${out.join('\n')}\n`)
if (refused.size > 0) process.stderr.write(`tool-budget: refused requests to ${[...refused].sort().join(', ')}\n`)

await ctx.fiber.dispose()
await rm(scratch, { recursive: true, force: true })
process.exit(0)
