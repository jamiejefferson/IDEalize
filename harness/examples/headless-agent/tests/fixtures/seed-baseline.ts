/**
 * Shared seeding helper for the workspace-context-resume Loader suites: writes
 * one persisted session carrying a visible workspace-instruction baseline, so
 * the resume snapshot and the session-format guard drive the same replay
 * fixture. Lives outside the *.snapshot.ts pattern so importing it never
 * re-registers another file's tests.
 * @module workspace-context-resume-seed
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { renderWorkspaceContext } from '@deepseek-ai/dsh-agent-instructions'
import { resolveConfig, workspaceBaselineIdentity } from '@deepseek-ai/dsh-agent-instructions/src/config.ts'

/** The session id the shared resume config (`workspace-context-resume.cordis.snapshot.yml`) resumes. */
export const resumeSessionId = SessionId('workspace-context-resume')

/** Baseline instruction text persisted into the seeded session. */
const oldInstruction = 'Old workspace instruction.'

/** Replacement instruction text written to disk while the session is offline. */
export const newInstruction = 'New workspace instruction after offline edit.'

/** Options for {@link seedVisibleBaseline}. */
export interface SeedBaselineOptions {
  /** Instruction files folded into the visible baseline; defaults to one AGENTS.md carrying {@link oldInstruction}. */
  files?: Array<{ name: string; content: string }>
  /** Instruction-file precedence override passed to the agent-instructions config. */
  instructionFileCandidates?: string[]
  /** Events appended verbatim after the baseline turn (seqs continue from 4). */
  trailingEvents?: SessionEvent[]
}

/**
 * Persist one closed-turn session whose log carries a visible
 * workspace-instruction baseline, returning the JSONL log path.
 * @param root - JSONL persistence root directory.
 * @param cwd - workspace directory recorded in the session header.
 * @param options - baseline contents, precedence, and trailing events.
 * @returns the absolute path of the seeded session's JSONL log.
 */
export async function seedVisibleBaseline(
  root: string,
  cwd: string,
  options: SeedBaselineOptions = {},
): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: resumeSessionId,
    createdAt: 1,
    cwd,
    delegationDepth: 0,
  }
  const files = options.files ?? [{ name: 'AGENTS.md', content: oldInstruction }]
  const baseline = renderWorkspaceContext(files.map(file => ({
    absolutePath: join(cwd, file.name),
    displayPath: file.name,
    content: file.content,
  })), { maxBytes: 65536 })
  const config = resolveConfig({
    dshHome: join(cwd, '.dsh'),
    maxBytes: 65536,
    ...options.instructionFileCandidates === undefined
      ? {}
      : { instructionFileCandidates: options.instructionFileCandidates },
  })
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: 0, time: 10, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      time: 11,
      data: createUserMessage({ content: [{ type: 'text', text: 'Remember the workspace instruction.' }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    },
    {
      type: 'user/message',
      seq: 2,
      time: 12,
      data: createUserMessage({
        content: [{ type: 'text', text: baseline.text }],
        source: {
          kind: 'agent-instructions',
          form: 'instructions',
          baseline: true,
          baselineIdentity: workspaceBaselineIdentity(config, cwd, cwd),
          changes: files.map(file => ({
            action: 'set',
            scope: `.\0${file.name}`,
            path: file.name,
            digest: createHash('sha1').update(file.content).digest('hex'),
          })),
        },
      }),
      surfaceOp: 'append',
    },
    { type: 'turn/end', seq: 3, time: 13, data: { turn: 1, reason: { kind: 'completed' } } },
    ...options.trailingEvents ?? [],
  ]
  try {
    await ctx.sessionPersistence.create(meta)
    await ctx.sessionPersistence.append(resumeSessionId, events)
    const location = ctx.sessionPersistence.locate(meta)
    if (location === undefined) throw new Error('JSONL backend did not locate the seeded session')
    return location.path
  } finally {
    await ctx.fiber.dispose()
  }
}
