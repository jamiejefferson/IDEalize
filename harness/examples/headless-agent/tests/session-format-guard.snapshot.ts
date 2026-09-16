/**
 * Assembled-app regression for the session-format refusal surface: resuming a
 * log written by a "newer" harness (format version ahead, or an unknown
 * required event type) fails loud through the real Loader composition, and the
 * error the product user sees names the direction and the raw log path.
 * @module session-format-guard-snapshot
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'
import { newInstruction, seedVisibleBaseline } from './fixtures/seed-baseline.ts'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'workspace-context-resume-snapshots/offline-edit')
const replayFixture = join(fixtureDir, 'replay.jsonl')
const replayOverride = join(fixtureDir, 'replay.override.json')
const configPath = fileURLToPath(new URL('../workspace-context-resume.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
// The resumed-agent fixture in the shared config resumes exactly this id.
const sessionId = SessionId('workspace-context-resume')

/** Persist one session with the given header version and events, returning its log path. */
async function seedSession(root: string, cwd: string, version: number, events: SessionEvent[]): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = { version, id: sessionId, createdAt: 1, cwd }
  try {
    await ctx.sessionPersistence.create(meta)
    await ctx.sessionPersistence.append(sessionId, events)
    const location = ctx.sessionPersistence.locate(meta)
    if (location === undefined) throw new Error('JSONL backend did not locate the seeded session')
    return location.path
  } finally {
    await ctx.fiber.dispose()
  }
}

function closedTurn(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('session format guard through the assembled app', () => {
  it('refuses to resume a newer-format log, naming the upgrade direction and the raw log path', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'newer-format resume refusal',
      tempDirPrefix: 'dsh-format-guard-version-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Try to resume.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture },
      expectedExitCode: 1,
      prepare: async (runCwd) => {
        sessionPath = await seedSession(join(runCwd, '.sessions'), runCwd, SESSION_FORMAT_VERSION + 99, closedTurn())
      },
    })
    expect(result.stderr).toContain(
      `session "${sessionId}" uses log format v${SESSION_FORMAT_VERSION + 99}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it`,
    )
    // macOS reports the temp dir via the /private symlink parent; assert the
    // stable path suffix instead of the realpath-dependent prefix.
    expect(result.stderr).toContain('(raw log: ')
    expect(result.stderr).toContain(sessionPath.slice(sessionPath.indexOf('/.sessions/')))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('refuses to resume a log with an unknown required event type', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'unknown-event resume refusal',
      tempDirPrefix: 'dsh-format-guard-event-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Try to resume.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture },
      expectedExitCode: 1,
      prepare: async (runCwd) => {
        sessionPath = await seedSession(join(runCwd, '.sessions'), runCwd, SESSION_FORMAT_VERSION, [
          ...closedTurn(),
          { type: 'future/event', seq: 2, time: 3, data: { payload: 1 } } as unknown as SessionEvent,
        ])
      },
    })
    expect(result.stderr).toContain(
      `session "${sessionId}" contains event type "future/event" (seq 2) unknown to this harness and not marked ignorable; refusing to interpret the log — it was likely written by a newer harness`,
    )
    // macOS reports the temp dir via the /private symlink parent; assert the
    // stable path suffix instead of the realpath-dependent prefix.
    expect(result.stderr).toContain('(raw log: ')
    expect(result.stderr).toContain(sessionPath.slice(sessionPath.indexOf('/.sessions/')))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('resumes a log whose unknown event carries the ignorable marker', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'ignorable unknown-event resume',
      tempDirPrefix: 'dsh-format-guard-ignorable-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Acknowledge the current workspace instruction.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      prepare: async (runCwd) => {
        await mkdir(join(runCwd, '.git'), { recursive: true })
        await writeFile(join(runCwd, 'AGENTS.md'), `${newInstruction}\n`)
        sessionPath = await seedVisibleBaseline(join(runCwd, '.sessions'), runCwd, {
          trailingEvents: [
            { type: 'future/event', seq: 4, time: 14, data: { payload: 1 }, ignorable: true } as unknown as SessionEvent,
          ],
        })
      },
      inspect: async () => {
        // The resumed turn re-persists the log; the foreign event survives verbatim.
        const persisted = await readFile(sessionPath, 'utf8')
        expect(persisted).toContain('"type":"future/event"')
        expect(persisted).toContain('"ignorable":true')
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>).at(-1))
      .toMatchObject({ type: 'result', sessionId, output: 'RESUME_DONE' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('resumes a log carrying idealize/space and re-persists the record verbatim', async () => {
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'idealize/space resume',
      tempDirPrefix: 'dsh-format-guard-space-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Acknowledge the current workspace instruction.'],
      tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      prepare: async (runCwd) => {
        await mkdir(join(runCwd, '.git'), { recursive: true })
        await writeFile(join(runCwd, 'AGENTS.md'), `${newInstruction}\n`)
        sessionPath = await seedVisibleBaseline(join(runCwd, '.sessions'), runCwd, {
          // The vocabulary the fork ships (`@idealize/spaces`), written the way
          // the space route writes it. This composition mounts no IDEalize
          // plugin, so the event is only read here — which is the point: the
          // generated KNOWN_SESSION_EVENT_TYPES is repo-wide, not per-composition.
          trailingEvents: [
            { type: 'idealize/space', seq: 4, time: 14, data: { space: 'gallery' }, ignorable: true } as unknown as SessionEvent,
          ],
        })
      },
      inspect: async () => {
        // The resumed turn re-persists the log; the space record survives verbatim.
        const persisted = await readFile(sessionPath, 'utf8')
        expect(persisted).toContain('"type":"idealize/space"')
        expect(persisted).toContain('"space":"gallery"')
        expect(persisted).toContain('"ignorable":true')
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>).at(-1))
      .toMatchObject({ type: 'result', sessionId, output: 'RESUME_DONE' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
