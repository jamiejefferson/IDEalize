/**
 * The durable per-project timeline: one append-only JSONL file per project
 * under the harness home. Appends are serialised per project, so `seq` is
 * per-project monotonic with no gaps; a torn final line from a crashed write
 * is dropped on load, while any other malformed line refuses the file.
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { StudioEventId, studioEventSchema } from './events.ts'
import type { StudioEvent, StudioEventInput } from './events.ts'

/**
 * Where a harness home keeps its Studio timelines.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/studio` under it.
 */
export function studioRootPath(dshHome: string): string {
  return join(dshHome, 'idealize', 'studio')
}

/**
 * A project's timeline file name: a readable slug plus a hash of the full
 * path, so two folders sharing a basename cannot share a timeline.
 * @param project - the resolved project folder.
 * @returns the file name, without directory.
 */
export function projectKey(project: string): string {
  const slug = basename(project).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'project'
  const hash = createHash('sha256').update(project).digest('hex').slice(0, 12)
  return `${slug}-${hash}.jsonl`
}

/** One append's outcome: the recorded event, and whether it already existed. */
export interface StudioAppendResult {
  event: StudioEvent
  /** True when the input's `messageId` was already recorded; nothing was written. */
  duplicate: boolean
}

/** The timeline store: loads lazily per project, appends through a per-project chain. */
export class StudioStore {
  private readonly timelines = new Map<string, StudioEvent[]>()
  private readonly byMessage = new Map<string, Map<string, StudioEvent>>()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly chains = new Map<string, Promise<void>>()

  constructor(readonly root: string) {}

  /**
   * A project's timeline file path.
   * @param project - the resolved project folder.
   * @returns the absolute JSONL path.
   */
  path(project: string): string {
    return join(this.root, projectKey(project))
  }

  /**
   * Read a project's file once; a missing file is an empty timeline.
   * @param project - the resolved project folder.
   */
  load(project: string): Promise<void> {
    let pending = this.loads.get(project)
    if (pending === undefined) {
      pending = this.read(project)
      this.loads.set(project, pending)
    }
    return pending
  }

  private async read(project: string): Promise<void> {
    const events: StudioEvent[] = []
    const messages = new Map<string, StudioEvent>()
    let text: string
    try {
      text = await readFile(this.path(project), 'utf8')
    } catch {
      this.timelines.set(project, events)
      this.byMessage.set(project, messages)
      return
    }
    // A final segment left by a write cut short of its newline is a torn
    // write: everything before it is intact, so the segment alone is dropped.
    const lines = text.split('\n')
    lines.pop()
    for (const [index, line] of lines.entries()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new Error(`${this.path(project)}:${index + 1} is not JSON — the timeline is corrupt`)
      }
      const checked = studioEventSchema.safeParse(parsed)
      if (!checked.success) throw new Error(`${this.path(project)}:${index + 1} is not a Studio event — the timeline is corrupt`)
      const event = { ...checked.data, id: StudioEventId(checked.data.id) }
      if (event.seq !== events.length + 1) {
        throw new Error(`${this.path(project)}:${index + 1} carries seq ${event.seq}, expected ${events.length + 1} — the timeline is out of order`)
      }
      events.push(event)
      if (event.messageId !== undefined) messages.set(event.messageId, event)
    }
    this.timelines.set(project, events)
    this.byMessage.set(project, messages)
  }

  /**
   * A project's events after a cursor, oldest first. Call after {@link load}.
   * @param project - the resolved project folder.
   * @param since - return events with `seq` greater than this; 0 for all.
   * @returns the retained events after the cursor.
   */
  events(project: string, since: number = 0): StudioEvent[] {
    const timeline = this.timelines.get(project) ?? []
    return since <= 0 ? [...timeline] : timeline.filter(event => event.seq > since)
  }

  /**
   * The newest recorded seq. Call after {@link load}.
   * @param project - the resolved project folder.
   * @returns the last event's seq, 0 for an empty timeline.
   */
  lastSeq(project: string): number {
    return this.timelines.get(project)?.at(-1)?.seq ?? 0
  }

  /**
   * Every project with a stored timeline, read off the first line of each
   * file (a line names its project, so the hashed file name never needs
   * reversing).
   * @returns the stored project folders, in directory order.
   */
  async storedProjects(): Promise<string[]> {
    let names: string[]
    try {
      names = await readdir(this.root)
    } catch {
      return []
    }
    const projects: string[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      let text: string
      try {
        text = await readFile(join(this.root, name), 'utf8')
      } catch {
        continue
      }
      const first = text.slice(0, text.indexOf('\n'))
      try {
        const parsed = JSON.parse(first) as { project?: unknown }
        if (typeof parsed.project === 'string' && parsed.project !== '') projects.push(parsed.project)
      } catch {
        // A torn or foreign first line: the file is not a readable timeline
        // head, and load() will refuse it loudly if something asks for it.
      }
    }
    return projects
  }

  /**
   * Record one event: identity, order and time are assigned here, and the
   * result resolves once the line is on disk. A `messageId` already recorded
   * for the project returns its event and writes nothing.
   * @param input - the validated submission.
   * @returns the recorded (or already-recorded) event.
   */
  append(input: StudioEventInput): Promise<StudioAppendResult> {
    const chained = (this.chains.get(input.project) ?? Promise.resolve()).then(async (): Promise<StudioAppendResult> => {
      await this.load(input.project)
      if (input.messageId !== undefined) {
        const existing = this.byMessage.get(input.project)?.get(input.messageId)
        if (existing !== undefined) return { event: existing, duplicate: true }
      }
      /* v8 ignore next -- load() above always seats the project's timeline; the guard only types the map read. */
      const timeline = this.timelines.get(input.project) ?? []
      const event: StudioEvent = {
        ...input,
        id: StudioEventId(`se-${randomUUID()}`),
        seq: (timeline.at(-1)?.seq ?? 0) + 1,
        at: new Date().toISOString(),
        visibility: input.visibility ?? 'studio',
      }
      await mkdir(this.root, { recursive: true })
      await appendFile(this.path(input.project), `${JSON.stringify(event)}\n`)
      timeline.push(event)
      this.timelines.set(input.project, timeline)
      if (event.messageId !== undefined) {
        /* v8 ignore next -- load() above always seats the project's message index; the guard only types the map read. */
        const messages = this.byMessage.get(input.project) ?? new Map<string, StudioEvent>()
        messages.set(event.messageId, event)
        this.byMessage.set(input.project, messages)
      }
      return { event, duplicate: false }
    })
    this.chains.set(input.project, chained.then(() => undefined, () => undefined))
    return chained
  }
}
