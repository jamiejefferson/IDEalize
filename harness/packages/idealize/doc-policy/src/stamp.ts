/**
 * Writing the two trust fields IDEalize owns onto notes on disk.
 *
 * `generated` is stamped by the host after an agent's file tool has written a
 * Markdown file inside the documentation folder, so the record never depends
 * on a model remembering to write it. The hook is the `fs/observed` event the
 * file tools emit once a write or edit has landed: its actor is the tool
 * execution, which names the tool and the agent it ran for. A read emits the
 * same event, so only the mutating tools count, and a call with no agent (a
 * person or a host job writing through the registry) is left alone.
 *
 * `verified` gains the user's entry when the user asks for it from the Files
 * pane ("Mark as checked").
 */

import { randomUUID } from 'node:crypto'
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsObservation, FsTarget } from '@deepseek-ai/dsh-fs'
import { addVerified, stampGenerated } from './trust.ts'

/** Folders the stamp leaves alone when the setting is unset: chat transcripts, which the host writes. */
export const DEFAULT_STAMP_EXCLUDE: readonly string[] = ['sessions/']

/** The actor recorded when the user marks a note as checked. IDEalize holds no name or account for the user. */
export const USER_ACTOR = 'human:user'

/** The mutating commands of `str_replace_editor`; `view` reads. */
const EDITOR_MUTATIONS = new Set(['create', 'str_replace', 'insert'])

/** What the stamp reads off a tool execution's agent, kept structural so this package needs no agent runtime types. */
interface StampAgent {
  session: {
    header: { agentPreset?: string }
    events: ReadonlyArray<{ type: string; data?: unknown }>
    requestHeader(): { config: { model?: string } } | undefined
  }
}

/**
 * The agent whose file tool just changed a file, read from an `fs/observed` actor.
 * @param actor - the event's opaque actor, normally the tool execution.
 * @returns the agent when the execution is an agent's write or edit; `undefined` for a read, another tool, or a call with no agent.
 */
export function mutatingAgent(actor: object | undefined): StampAgent | undefined {
  const exec: { name?: unknown; arguments?: unknown; agent?: StampAgent } | undefined = actor
  if (exec?.agent === undefined) return undefined
  if (exec.name === 'write' || exec.name === 'edit') return exec.agent
  if (exec.name !== 'str_replace_editor') return undefined
  const command = (exec.arguments as { command?: unknown } | null | undefined)?.command
  return typeof command === 'string' && EDITOR_MUTATIONS.has(command) ? exec.agent : undefined
}

function eventValue(agent: StampAgent, type: string, field: string): string | undefined {
  const event = agent.session.events.findLast(candidate => candidate.type === type)
  const value = (event?.data as Record<string, unknown> | undefined)?.[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const slug = (text: string): string => text.trim().replaceAll(/\s+/g, '-')

/**
 * The actor id of an IDEalize agent: `idealize/<brain>/<model>`. The brain is
 * the chat's recorded brain, else the agent preset it runs; the model is the
 * one its latest request went to.
 * @param agent - the agent that wrote the file.
 * @returns the actor id; a part the session does not record is left out, and a session that records neither reads `idealize/agent`.
 */
export function agentActor(agent: StampAgent): string {
  const brain = eventValue(agent, 'idealize/brain', 'brain')
    ?? eventValue(agent, 'agent-preset/selected', 'agentPreset')
    ?? agent.session.header.agentPreset
  const model = agent.session.requestHeader()?.config.model
  const parts = [brain, model].filter((part): part is string => part !== undefined && part.trim() !== '').map(slug)
  return ['idealize', ...parts.length === 0 ? ['agent'] : parts].join('/')
}

/**
 * A file's path inside a folder, with symlinks resolved on both sides.
 * @param folder - the folder.
 * @param path - the file's path.
 * @returns the `/`-separated relative path, or `undefined` when the file is outside the folder or either path cannot be resolved.
 */
export async function pathWithin(folder: string, path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return undefined
  try {
    const rel = relative(await realpath(folder), await realpath(path))
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split(sep).join('/')
  } catch {
    return undefined
  }
}

/**
 * Whether a note sits in a folder the stamp leaves alone.
 * @param relPath - the note's `/`-separated path inside the documentation folder.
 * @param exclude - folder names or paths; each matches a folder of that name at any depth.
 * @returns true when one entry names a folder on the note's path.
 */
export function isStampExcluded(relPath: string, exclude: readonly string[]): boolean {
  const haystack = `/${relPath}`
  return exclude
    .map(entry => entry.trim().replaceAll(/^\/+|\/+$/g, ''))
    .some(entry => entry !== '' && haystack.includes(`/${entry}/`))
}

/** Replace a file's text through a sibling temporary file, keeping its mode. */
async function replaceFile(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text)
    await chmod(temporary, (await stat(path)).mode)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** The settings the stamp reads at the moment a write lands. */
export interface StampSource {
  /** The configured documentation folder, or `undefined` before setup. */
  folder(): string | undefined
  /** The folders to leave alone. */
  stampExclude(): readonly string[]
}

/**
 * Stamp `generated` on Markdown files an agent's file tool writes inside the
 * documentation folder. The stamp runs after the tool has returned, on a
 * file still at the version the tool left; a file changed again in between
 * is left for that later write's own stamp. The new version is then recorded
 * for the same agent, so its next edit of the note is not refused as stale.
 * @param ctx - a context with `ctx.fs`.
 * @param source - the documentation folder and excluded folders in force.
 * @param now - the clock; tests pin it.
 */
export function applyGeneratedStamp(ctx: Context, source: StampSource, now: () => Date = () => new Date()): void {
  const inflight = new Set<Promise<void>>()
  // Set while this plugin records its own write, so the listener skips it.
  let recording = false

  const stamp = async (target: FsTarget, observation: FsObservation & { kind: 'present' }, actor: object, by: string): Promise<void> => {
    const folder = source.folder()
    if (folder === undefined) return
    const relPath = await pathWithin(folder, target.displayPath)
    if (relPath === undefined || isStampExcluded(relPath, source.stampExclude())) return
    if ((await ctx.fs.stat(target))?.version !== observation.version) return
    const text = await readFile(target.displayPath, 'utf8')
    await replaceFile(target.displayPath, stampGenerated(text, by, now().toISOString().replace(/\.\d{3}Z$/, 'Z')))
    const after = await ctx.fs.stat(target)
    /* v8 ignore next -- only a deletion in the instant after the rename leaves nothing to record. */
    if (after === undefined) return
    recording = true
    try {
      ctx.emit('fs/observed', target, { kind: 'present', version: after.version }, actor)
    } finally {
      recording = false
    }
  }

  ctx.on('fs/observed', (target, observation, actor) => {
    if (recording || observation.kind !== 'present' || actor === undefined) return
    if (!target.displayPath.toLowerCase().endsWith('.md')) return
    const agent = mutatingAgent(actor)
    if (agent === undefined) return
    const work = stamp(target, observation, actor, agentActor(agent))
      .catch((error: unknown) => {
        ctx.logger.warn('idealize-doc-policy: stamping `generated` failed (the note keeps the agent\'s text)')
        ctx.logger.warn(error)
      })
      .finally(() => { inflight.delete(work) })
    inflight.add(work)
  })
  ctx.effect(() => () => Promise.allSettled([...inflight]).then(() => undefined), 'idealize-doc-policy: settle generated stamps')
}

/** The outcome of marking one note as checked. */
export type MarkCheckedResult =
  | { ok: true; by: string; at: string }
  | { ok: false; reason: 'not-markdown' | 'unreadable' }

/**
 * Add the user to one note's `verified` list with the current instant.
 * @param path - absolute path of the note; the caller has already confined it to a folder the user chose.
 * @param now - the instant to record.
 * @returns who and when was recorded, or why nothing was written.
 */
export async function markChecked(path: string, now: Date = new Date()): Promise<MarkCheckedResult> {
  if (!path.toLowerCase().endsWith('.md')) return { ok: false, reason: 'not-markdown' }
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  try {
    await replaceFile(path, addVerified(await readFile(path, 'utf8'), USER_ACTOR, at))
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  return { ok: true, by: USER_ACTOR, at }
}
