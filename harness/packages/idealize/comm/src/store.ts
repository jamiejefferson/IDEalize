/**
 * The command surface's durable state: per-session mailboxes, the piece
 * ladder (rungs), status labels, each chat's own note line, roles, and the
 * names spawn gave its children. One JSON document under the harness home;
 * writes are atomic (temp file + rename) and serialised, so a burst of
 * `send`s cannot interleave half-written documents.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CommMessage, CommRung } from './wire.ts'

/**
 * Roles the addressing aliases resolve through; the lead role was retired for
 * the group chat (JJ, 1 Sep). `project-agent` coordinates one project folder
 * and is found by that folder; `studio-agent` coordinates the Studio itself,
 * spans every project, and is found by the role alone — there is one.
 */
export type CommRole = 'project-agent' | 'studio-agent'

/** The persisted document. */
export interface CommState {
  mailboxes: Record<string, CommMessage[]>
  rungs: Record<string, CommRung>
  statuses: Record<string, string>
  roles: Record<string, CommRole>
  names: Record<string, string>
  /** Project folder → name-pool index. */
  pools: Record<string, number>
  /** Session → its brief-derived or user-given task title, for sessions the surface named. */
  titles: Record<string, string>
}

const EMPTY: CommState = { mailboxes: {}, rungs: {}, statuses: {}, roles: {}, names: {}, pools: {}, titles: {} }

/**
 * Where the document lives under one harness home.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/comm.json` under it.
 */
export function commStorePath(dshHome: string): string {
  return join(dshHome, 'idealize', 'comm.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a stored document, dropping unknown or malformed sections rather than refusing the file.
 * @param text - the document's JSON text.
 * @returns the state; unparseable text yields the empty state.
 */
export function parseCommState(text: string): CommState {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return structuredClone(EMPTY)
  }
  if (!isRecord(raw)) return structuredClone(EMPTY)
  const section = <T>(key: keyof CommState, keep: (value: unknown) => value is T): Record<string, T> => {
    const input = raw[key]
    if (!isRecord(input)) return {}
    const out: Record<string, T> = {}
    for (const [id, value] of Object.entries(input)) if (keep(value)) out[id] = value
    return out
  }
  const isString = (value: unknown): value is string => typeof value === 'string'
  // A stored 'lead' role is dropped on load: the migration the retirement wants.
  const isRole = (value: unknown): value is CommRole => value === 'project-agent' || value === 'studio-agent'
  const isMessages = (value: unknown): value is CommMessage[] => Array.isArray(value)
    && value.every(item => isRecord(item) && typeof item.from === 'string' && typeof item.body === 'string' && typeof item.timestamp === 'string')
  const isRung = (value: unknown): value is CommRung => isRecord(value)
    && typeof value.piece === 'string' && typeof value.rung === 'string' && typeof value.blocker === 'string'
    && typeof value.session === 'string' && typeof value.updated === 'string'
  return {
    mailboxes: section('mailboxes', isMessages),
    rungs: section('rungs', isRung),
    statuses: section('statuses', isString),
    roles: section('roles', isRole),
    names: section('names', isString),
    pools: section('pools', (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0),
    titles: section('titles', isString),
  }
}

/** The durable document's in-memory copy: reads are synchronous after `load()`, mutations resolve when their atomic write lands. */
export class CommStore {
  private state: CommState = structuredClone(EMPTY)
  private loaded: Promise<void> | undefined
  private chain: Promise<void> = Promise.resolve()

  constructor(readonly path: string) {}

  /** Read the document once; a missing file is an empty state. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.state = parseCommState(await readFile(this.path, 'utf8'))
      } catch {
        // No document yet: the first mutation creates it.
      }
    })()
    return this.loaded
  }

  /** Mutate the state and queue an atomic write; resolves when the write lands. */
  private async mutate(change: (state: CommState) => void): Promise<void> {
    await this.load()
    change(this.state)
    const snapshot = JSON.stringify(this.state, null, 2)
    this.chain = this.chain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.${process.pid}.tmp`
      await writeFile(tmp, `${snapshot}\n`)
      await rename(tmp, this.path)
    })
    await this.chain
  }

  /**
   * Queue a message on one session's mailbox.
   * @param sessionId - the recipient session.
   * @param message - the message to append.
   */
  deliver(sessionId: string, message: CommMessage): Promise<void> {
    return this.mutate((state) => {
      (state.mailboxes[sessionId] ??= []).push(message)
    })
  }

  /**
   * Read a mailbox without clearing it.
   * @param sessionId - the mailbox's session.
   * @returns a copy of the queued messages, oldest first; empty for an unknown session.
   */
  peek(sessionId: string): CommMessage[] {
    return [...this.state.mailboxes[sessionId] ?? []]
  }

  /**
   * Unread count for one session.
   * @param sessionId - the mailbox's session.
   * @returns the queued message count, 0 for an unknown session.
   */
  unread(sessionId: string): number {
    return this.state.mailboxes[sessionId]?.length ?? 0
  }

  /**
   * Read and clear a mailbox.
   * @param sessionId - the mailbox's session.
   * @returns the messages that were queued, oldest first; an empty mailbox writes nothing.
   */
  async drain(sessionId: string): Promise<CommMessage[]> {
    const messages = this.peek(sessionId)
    if (messages.length > 0) await this.mutate((state) => { Reflect.deleteProperty(state.mailboxes, sessionId) })
    return messages
  }

  /**
   * Record a session's piece-ladder rung.
   * @param sessionId - the reporting session.
   * @param rung - the rung record.
   */
  setRung(sessionId: string, rung: CommRung): Promise<void> {
    return this.mutate((state) => { state.rungs[sessionId] = rung })
  }

  /**
   * Every recorded rung, for the board.
   * @returns the rungs in insertion order.
   */
  rungs(): CommRung[] {
    return Object.values(this.state.rungs)
  }

  /**
   * Set or clear a session's status label.
   * @param sessionId - the session.
   * @param status - the label; undefined clears it.
   */
  setStatus(sessionId: string, status: string | undefined): Promise<void> {
    return this.mutate((state) => {
      if (status === undefined) Reflect.deleteProperty(state.statuses, sessionId)
      else state.statuses[sessionId] = status
    })
  }

  /**
   * A session's status label.
   * @param sessionId - the session.
   * @returns the label, or undefined when none is set.
   */
  status(sessionId: string): string | undefined {
    return this.state.statuses[sessionId]
  }

  /**
   * Assign or clear a session's role.
   * @param sessionId - the session.
   * @param role - the role; undefined clears it.
   */
  setRole(sessionId: string, role: CommRole | undefined): Promise<void> {
    return this.mutate((state) => {
      if (role === undefined) Reflect.deleteProperty(state.roles, sessionId)
      else state.roles[sessionId] = role
    })
  }

  /**
   * A session's role.
   * @param sessionId - the session.
   * @returns the role, or undefined for an ordinary chat.
   */
  role(sessionId: string): CommRole | undefined {
    return this.state.roles[sessionId]
  }

  /**
   * Every session holding a role, for alias resolution.
   * @returns a copy of the session→role map.
   */
  roles(): Record<string, CommRole> {
    return { ...this.state.roles }
  }

  /**
   * Record the name a session was given.
   * @param sessionId - the session.
   * @param name - the drawn name.
   */
  setName(sessionId: string, name: string): Promise<void> {
    return this.mutate((state) => { state.names[sessionId] = name })
  }

  /**
   * The name a session was given.
   * @param sessionId - the session.
   * @returns the name, or undefined when the session was never named.
   */
  name(sessionId: string): string | undefined {
    return this.state.names[sessionId]
  }

  /**
   * Every name currently held, for collision-free drawing.
   * @returns a fresh set of the held names.
   */
  takenNames(): Set<string> {
    return new Set(Object.values(this.state.names))
  }

  /**
   * Record which name pool a project draws from.
   * @param projectPath - the project's canonical folder.
   * @param pool - the pool index.
   */
  setPool(projectPath: string, pool: number): Promise<void> {
    return this.mutate((state) => { state.pools[projectPath] = pool })
  }

  /**
   * Every project's recorded pool.
   * @returns a copy of the project→pool map.
   */
  pools(): Record<string, number> {
    return { ...this.state.pools }
  }

  /**
   * Record a session's task title.
   * @param sessionId - the session.
   * @param title - the brief-derived or user-given title.
   */
  setTitle(sessionId: string, title: string): Promise<void> {
    return this.mutate((state) => { state.titles[sessionId] = title })
  }

  /**
   * A session's recorded task title.
   * @param sessionId - the session.
   * @returns the title, or undefined when the surface never named it.
   */
  title(sessionId: string): string | undefined {
    return this.state.titles[sessionId]
  }
}
