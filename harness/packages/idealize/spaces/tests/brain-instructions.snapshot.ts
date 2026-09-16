/**
 * Assembled-app coverage for the brain's standing instructions as a
 * model-visible input.
 *
 * The driver boots the real Loader, runs one turn on the composition's own
 * brain, records a switch through `recordSelection` exactly as
 * `POST /idealize/spaces/select` does, and runs a second turn on the same chat.
 * The persisted log then carries both model requests, and `request/header`
 * carries the system prompt each one was sent with — so the switch is pinned
 * from the transcript rather than from a unit fold.
 *
 * A second run resumes that same log in a fresh process and pins the prompt
 * again. That is what "reconstructable from the log" has to mean for an input
 * the model reads: the process that recorded the switch is gone, and the
 * record on disk is the only statement of the brain's voice left.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = fileURLToPath(new URL('./brain-instructions-snapshots/switch', import.meta.url))
const replayOverride = join(scenarioDir, 'replay.override.json')
const resumeOverride = join(scenarioDir, 'resume.override.json')
const promptExpected = join(scenarioDir, 'system-prompt.expected.md')
const switchConfig = fileURLToPath(new URL('./brain-switch.cordis.snapshot.yml', import.meta.url))
const resumeConfig = fileURLToPath(new URL('./brain-switch-resume.cordis.snapshot.yml', import.meta.url))
const switchDriver = fileURLToPath(new URL('./fixtures/brain-switch-driver.ts', import.meta.url))
const headlessDriver = fileURLToPath(
  new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh' || process.env.DSH_SNAPSHOT === 'record'

/** The composition's persona: the brain the chat starts on. */
const CODING_VOICE = 'You are the Coding brain. Answer with code and nothing else.'
/** The brain the chat is switched to, and its standing instructions. */
const DESIGN_BRAIN = 'design'
const DESIGN_VOICE = 'You are the Design brain. Lead with the sketch, never the code.'

/** One persisted session log of a run, with the relative path the backend chose for it. */
interface PersistedLog {
  relPath: string
  text: string
}

/** The single persisted session log under a run's cwd. */
async function readSessionLog(runCwd: string): Promise<PersistedLog> {
  const sessionsDir = join(runCwd, '.sessions')
  const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const [relPath] = files
  if (relPath === undefined || files.length !== 1) {
    throw new Error(`expected one persisted session log, found ${files.length}`)
  }
  return { relPath, text: await readFile(join(sessionsDir, relPath), 'utf8') }
}

/** Every system prompt a log's request headers carry, in request order. */
function systemPrompts(log: string): string[] {
  return log.split('\n').filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { type?: string; data?: { header?: { system?: unknown } } })
    .filter(event => event.type === 'request/header')
    .map(event => event.data?.header?.system)
    .filter((system): system is string => typeof system === 'string')
}

/** The session id a persisted log's header records. */
function sessionIdOf(log: string): string {
  const [first] = log.split('\n')
  if (first === undefined) throw new Error('the persisted log is empty')
  const id = (JSON.parse(first) as { id?: unknown }).id
  if (typeof id !== 'string') throw new Error('the persisted log header carries no session id')
  return id
}

describe('the brain instructions assembled snapshot', () => {
  it('sends the switched-to brain\'s instructions, and rebuilds them from the log alone', async () => {
    let switched: PersistedLog | undefined
    const first = await runLoaderSmoke({
      label: 'idealize brain switch mid-conversation',
      tempDirPrefix: 'idealize-brain-switch-',
      binScript: switchDriver,
      libBinScript: switchDriver,
      configPath: switchConfig,
      binArgs: [switchConfig, DESIGN_BRAIN, DESIGN_VOICE],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayOverride, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      inspect: async (runCwd) => {
        // The harness points DSH_HOME at this run's temp cwd, so nothing here
        // can reach a real IDEalize home.
        expect(runCwd.startsWith('/')).toBe(true)
        switched = await readSessionLog(runCwd)

        const log = switched.text
        // The switch is in the log, carrying the instructions verbatim.
        expect(log).toContain('"type":"idealize/brain"')
        expect(log).toContain(`"brain":"${DESIGN_BRAIN}"`)
        expect(log).toContain('"ignorable":true')

        const prompts = systemPrompts(log)
        expect(prompts).toHaveLength(2)
        const [beforeSwitch, afterSwitch] = prompts as [string, string]
        // Before: the composition's own brain speaks.
        expect(beforeSwitch).toContain(CODING_VOICE)
        expect(beforeSwitch).not.toContain(DESIGN_VOICE)
        // After: the logged brain speaks, and the old brain is gone — not
        // stacked underneath it.
        expect(afterSwitch).toContain(DESIGN_VOICE)
        expect(afterSwitch).not.toContain(CODING_VOICE)

        if (refreshing) {
          await mkdir(dirname(promptExpected), { recursive: true })
          await writeFile(promptExpected, `${afterSwitch}\n`)
        }
        expect(`${afterSwitch}\n`).toBe(await readFile(promptExpected, 'utf8'))
      },
    })

    expect(first.stderr).toBe('')
    const turns = first.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(turns.map(turn => [turn['phase'], turn['output']]))
      .toEqual([['before', 'BEFORE_SWITCH'], ['after', 'AFTER_SWITCH']])

    if (switched === undefined) throw new Error('the switch run persisted no session log')
    const carried = switched
    const sessionId = sessionIdOf(carried.text)
    const expectedPrompt = (await readFile(promptExpected, 'utf8')).trimEnd()

    // Replay: a fresh process, the log as the only carrier of the switch.
    const replayed = await runLoaderSmoke({
      label: 'idealize brain switch replayed from the log',
      tempDirPrefix: 'idealize-brain-replay-',
      binScript: headlessDriver,
      libBinScript: headlessDriver,
      configPath: resumeConfig,
      binArgs: [resumeConfig, 'Introduce yourself once more.'],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT_FILE: resumeOverride,
        DSH_SNAPSHOT_OVERRIDE: resumeOverride,
        DSH_BRAIN_RESUME_ID: sessionId,
      },
      prepare: async (runCwd) => {
        const target = join(runCwd, '.sessions', carried.relPath)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, carried.text)
      },
      inspect: async (runCwd) => {
        const prompts = systemPrompts((await readSessionLog(runCwd)).text)
        // Two from the carried log, one from the resumed turn.
        expect(prompts).toHaveLength(3)
        expect(prompts.at(-1)).toBe(expectedPrompt)
      },
    })

    expect(replayed.stderr).toBe('')
    expect(replayed.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>).at(-1))
      .toMatchObject({ type: 'result', sessionId, output: 'REPLAYED' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)

  it('silences the composition persona for a brain carrying no instructions', async () => {
    const result = await runLoaderSmoke({
      label: 'idealize brain switch to a brain with no instructions',
      tempDirPrefix: 'idealize-brain-bare-',
      binScript: switchDriver,
      libBinScript: switchDriver,
      configPath: switchConfig,
      binArgs: [switchConfig, 'bare', ''],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayOverride, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      inspect: async (runCwd) => {
        const prompts = systemPrompts((await readSessionLog(runCwd)).text)
        expect(prompts).toHaveLength(2)
        const [beforeSwitch, afterSwitch] = prompts as [string, string]
        expect(beforeSwitch).toContain(CODING_VOICE)
        // The persona slot renders to nothing rather than to an empty section:
        // the old brain is gone and no blank heading takes its place.
        expect(afterSwitch).not.toContain(CODING_VOICE)
        expect(afterSwitch).not.toContain('\n\n\n')
      },
    })

    expect(result.stderr).toBe('')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
