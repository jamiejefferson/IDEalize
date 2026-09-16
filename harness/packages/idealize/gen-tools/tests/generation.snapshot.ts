/**
 * Assembled-app coverage for the generation toolset: the headless driver boots
 * the real Loader over `generation.cordis.snapshot.yml`, the replay adapter
 * scripts one `generate_image` call, and the fixture backend serves the bytes.
 * The run is pinned three ways — the model-visible tool result, the persisted
 * event sequence, and the committed `artefact/created` payload, which
 * `artefact-chat-node.client.spec.ts` folds into the transcript node so the
 * chat node is proved over an event a real turn produced.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = fileURLToPath(new URL('./generation-snapshots/fixture-image', import.meta.url))
const replayOverride = join(scenarioDir, 'replay.override.json')
const eventExpected = join(scenarioDir, 'artefact-created.event.json')
const configPath = fileURLToPath(new URL('./generation.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh' || process.env.DSH_SNAPSHOT === 'record'
const task = 'Make me an image of a small brass fish.'

/** The `artefact/created` payload with every run-unique value tokenised. */
interface StableRecord {
  schemaVersion: number
  id: string
  mediaType: string
  storage: { kind: string; relPath: string; bytes: number; sha256: string }
  sourceTask: { sessionId: string; turnSeq: number; callId: string; toolName: string }
  settings: unknown
  provenance: { provider: string; model: string; createdAt: string; workspaceId: string }
}

/**
 * Replace the values a fresh run necessarily changes (ids, the month segment,
 * the creation instant) with tokens, so the committed payload stays a stable
 * expected output on every machine and month.
 * @param record - the record exactly as the log carries it.
 * @returns the same record with run-unique values tokenised.
 */
function tokenize(record: StableRecord): StableRecord {
  return {
    ...record,
    id: '<artefact-id>',
    storage: {
      ...record.storage,
      relPath: record.storage.relPath.replace(/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.png$/, '<day>_<artefact-id>.png'),
    },
    sourceTask: { ...record.sourceTask, sessionId: '<session-id>' },
    provenance: { ...record.provenance, createdAt: '<created-at>', workspaceId: '<workspace-id>' },
  }
}

/** The one persisted session log of a scenario run. */
async function readSessionLog(runCwd: string): Promise<string> {
  const sessionsDir = join(runCwd, '.sessions')
  const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const [file] = files
  if (file === undefined || files.length !== 1) throw new Error(`expected one persisted session log, found ${files.length}`)
  return readFile(join(sessionsDir, file), 'utf8')
}

describe('generation tools assembled snapshot', () => {
  it('commits a fixture-backed generate_image turn as a project artefact', async () => {
    const result = await runLoaderSmoke({
      label: 'idealize generation tools headless snapshot',
      tempDirPrefix: 'idealize-gen-tools-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, task],
      tsconfigPath,
      env: {
        DSH_SNAPSHOT_FILE: replayOverride,
        DSH_SNAPSHOT_OVERRIDE: replayOverride,
      },
      inspect: async (runCwd) => {
        const log = await readSessionLog(runCwd)
        const events = log.split('\n').filter(line => line.trim() !== '').slice(1)
          .map(line => JSON.parse(line) as { type?: string; data?: unknown })

        // The turn's durable spine: the tool call, the artefact commit, and
        // the assistant's report, in that order.
        expect(events.map(event => event.type).filter(type =>
          type === 'tool/call' || type === 'artefact/created' || type === 'assistant/message'))
          .toEqual(['assistant/message', 'tool/call', 'artefact/created', 'assistant/message'])

        const created = events.find(event => event.type === 'artefact/created')
        if (created === undefined) throw new Error('the turn logged no artefact/created event')
        const record = (created.data as { record: StableRecord }).record
        const stable = tokenize(record)
        if (refreshing) await writeFile(eventExpected, `${JSON.stringify(stable, undefined, 2)}\n`)
        expect(stable).toEqual(JSON.parse(await readFile(eventExpected, 'utf8')) as StableRecord)

        // The bytes really landed in the project folder the record names.
        const absolute = join(runCwd, record.storage.relPath)
        expect((await stat(absolute)).size).toBe(record.storage.bytes)
        expect(createHash('sha256').update(await readFile(absolute)).digest('hex')).toBe(record.storage.sha256)

        // Model-visible: the tool result names the artefact the model must report.
        expect(log).toContain(`image/png artefact ${record.id}`)
      },
    })

    expect(result.stderr).toBe('')
    const records = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.at(-1)).toMatchObject({
      type: 'result',
      output: 'The image is stored in the gallery. GALLERY_DONE',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
