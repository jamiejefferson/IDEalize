/**
 * Assembled-app coverage for the learnings loop's model-visible inputs and its
 * one durable effect.
 *
 * The driver boots the real Loader over a composition holding the
 * documentation service, the skill registry with its catalogue and loader, and
 * this package. A replayed model calls `skill_learning` once. The persisted
 * log then carries everything the model was sent (the standing prompt line and
 * the tool schema in `request/header`, the shipped `fold-learnings` skill in
 * the session catalogue, and the tool's result), and the documentation folder
 * carries the one line the call appended.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'
import { LEARNINGS_GUIDANCE } from '../src/index.ts'

const scenarioDir = fileURLToPath(new URL('./skill-learning-snapshots/record', import.meta.url))
const replayOverride = join(scenarioDir, 'replay.override.json')
const expectedPath = join(scenarioDir, 'model-inputs.expected.md')
const configPath = fileURLToPath(new URL('./skill-learning.cordis.snapshot.yml', import.meta.url))
const headlessDriver = fileURLToPath(
  new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh' || process.env.DSH_SNAPSHOT === 'record'

interface LoggedEvent {
  type?: string
  data?: {
    header?: { system?: string; tools?: { name: string }[] }
    source?: { kind?: string; entries?: { name: string; description: string }[] }
    /** A tool result message holds one tool-result block, which holds the content the model reads. */
    message?: { content?: { content?: { type: string; text?: string }[] }[] }
  }
}

/** Every event of the single persisted session log under a run's cwd. */
async function sessionEvents(runCwd: string): Promise<LoggedEvent[]> {
  const sessionsDir = join(runCwd, '.sessions')
  const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const [relPath] = files
  if (relPath === undefined || files.length !== 1) throw new Error(`expected one persisted session log, found ${String(files.length)}`)
  return (await readFile(join(sessionsDir, relPath), 'utf8'))
    .split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as LoggedEvent)
}

describe('the skill learning assembled snapshot', () => {
  it('sends the standing line, the tool and the shipped skill, and appends the one line the model asked for', async () => {
    const result = await runLoaderSmoke({
      label: 'idealize skill learning recorded',
      tempDirPrefix: 'idealize-skill-learning-',
      binScript: headlessDriver,
      libBinScript: headlessDriver,
      configPath,
      binArgs: [configPath, 'Fold the learnings for the release skill.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayOverride, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      prepare: async (runCwd) => { await mkdir(join(runCwd, 'vault'), { recursive: true }) },
      inspect: async (runCwd) => {
        const events = await sessionEvents(runCwd)
        const header = events.find(event => event.type === 'request/header')?.data?.header
        const section = header?.system?.split('\n').find(line => line.startsWith('When a step in a skill you loaded'))
        const tool = header?.tools?.find(candidate => candidate.name === 'skill_learning')
        const catalogue = events.find(event => event.type === 'user/message' && event.data?.source?.kind === 'skill-catalog')
        const entry = catalogue?.data?.source?.entries?.find(candidate => candidate.name === 'fold-learnings')
        const toolResult = events.find(event => event.type === 'tool/result')?.data?.message?.content
          ?.flatMap(block => block.content ?? []).map(block => block.text ?? '').join('')
        expect(section).toBe(LEARNINGS_GUIDANCE)

        const file = join(runCwd, 'vault', 'Reference', 'playbook-learnings', 'fold-learnings.md')
        const written = await readFile(file, 'utf8')
        // The run's own date is the one moving part; everything else is pinned.
        const day = /^created: (\d{4}-\d{2}-\d{2})$/m.exec(written)?.[1]
        expect(day).toBeDefined()
        const pinned = [
          '# What the model is sent, and what the call leaves on disk',
          '',
          '## Standing prompt line',
          '',
          String(section),
          '',
          '## Tool schema',
          '',
          '```json',
          JSON.stringify(tool, null, 2),
          '```',
          '',
          '## Session catalogue entry of the shipped skill',
          '',
          `- \`${String(entry?.name)}\`: ${String(entry?.description)}`,
          '',
          '## Tool result',
          '',
          String(toolResult),
          '',
          '## Reference/playbook-learnings/fold-learnings.md',
          '',
          written,
        ].join('\n').replaceAll(String(day), '<date>')

        if (refreshing) {
          await mkdir(dirname(expectedPath), { recursive: true })
          await writeFile(expectedPath, pinned)
        }
        expect(pinned).toBe(await readFile(expectedPath, 'utf8'))
        expect(await readdir(join(runCwd, 'vault', 'Reference', 'playbook-learnings'))).toEqual(['fold-learnings.md'])
      },
    })

    // The documentation index opens node:sqlite, which Node announces once on stderr.
    const stderr = result.stderr.split('\n')
      .filter(line => line !== '' && !line.includes('ExperimentalWarning: SQLite') && !line.includes('--trace-warnings'))
    expect(stderr).toEqual([])
    expect(result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>).at(-1))
      .toMatchObject({ type: 'result', output: 'RECORDED' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
