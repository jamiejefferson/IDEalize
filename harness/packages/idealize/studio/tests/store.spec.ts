/**
 * The store's durability promises: monotonic gap-free seq, restart survival,
 * duplicate suppression on the logical message id, torn-write recovery, and
 * loud refusal of a corrupt timeline.
 */

import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StudioEventInput } from '../src/events.ts'
import { projectKey, StudioStore } from '../src/store.ts'

const PROJECT = '/work/demo'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function freshStore(): Promise<StudioStore> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-studio-'))
  roots.push(root)
  return new StudioStore(root)
}

function message(body: string, extra: Partial<StudioEventInput> = {}): StudioEventInput {
  return { project: PROJECT, author: 'user', kind: 'message', body, ...extra }
}

describe('StudioStore', () => {
  it('assigns 1-based monotonic seq and stable ids', async () => {
    const store = await freshStore()
    const first = await store.append(message('one'))
    const second = await store.append(message('two'))
    expect(first.event.seq).toBe(1)
    expect(second.event.seq).toBe(2)
    expect(first.event.id).not.toBe(second.event.id)
    expect(first.duplicate).toBe(false)
  })

  it('serialises a burst of appends into unique seqs', async () => {
    const store = await freshStore()
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => store.append(message(`m${index}`))))
    const seqs = results.map(result => result.event.seq).sort((a, b) => a - b)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('survives a restart: a fresh store replays the same events and continues the seq', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    await store.append(message('two'))
    const reborn = new StudioStore(store.root)
    await reborn.load(PROJECT)
    expect(reborn.events(PROJECT).map(event => event.body)).toEqual(['one', 'two'])
    const third = await reborn.append(message('three'))
    expect(third.event.seq).toBe(3)
  })

  it('returns the recorded event for a repeated messageId and writes nothing', async () => {
    const store = await freshStore()
    const first = await store.append(message('once', { messageId: 'm-1' }))
    const retry = await store.append(message('once again', { messageId: 'm-1' }))
    expect(retry.duplicate).toBe(true)
    expect(retry.event.id).toBe(first.event.id)
    expect(store.events(PROJECT)).toHaveLength(1)
    const lines = (await readFile(store.path(PROJECT), 'utf8')).split('\n').filter(line => line !== '')
    expect(lines).toHaveLength(1)
  })

  it('suppresses a duplicate messageId across a restart', async () => {
    const store = await freshStore()
    await store.append(message('once', { messageId: 'm-1' }))
    const reborn = new StudioStore(store.root)
    const retry = await reborn.append(message('again', { messageId: 'm-1' }))
    expect(retry.duplicate).toBe(true)
    expect(reborn.events(PROJECT)).toHaveLength(1)
  })

  it('drops a torn final line and keeps everything before it', async () => {
    const store = await freshStore()
    await store.append(message('kept'))
    await appendFile(store.path(PROJECT), '{"id":"se-torn","seq":2')
    const reborn = new StudioStore(store.root)
    await reborn.load(PROJECT)
    expect(reborn.events(PROJECT).map(event => event.body)).toEqual(['kept'])
    const next = await reborn.append(message('after'))
    expect(next.event.seq).toBe(2)
  })

  it('refuses a corrupt middle line loudly', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    const intact = await readFile(store.path(PROJECT), 'utf8')
    await writeFile(store.path(PROJECT), `not json\n${intact}`)
    const reborn = new StudioStore(store.root)
    await expect(reborn.load(PROJECT)).rejects.toThrow(/not JSON/)
  })

  it('refuses an out-of-order timeline loudly', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    const line = (await readFile(store.path(PROJECT), 'utf8')).trim()
    await writeFile(store.path(PROJECT), `${line}\n${line}\n`)
    const reborn = new StudioStore(store.root)
    await expect(reborn.load(PROJECT)).rejects.toThrow(/out of order/)
  })

  it('filters by the since cursor', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    await store.append(message('two'))
    await store.append(message('three'))
    expect(store.events(PROJECT, 2).map(event => event.body)).toEqual(['three'])
    expect(store.lastSeq(PROJECT)).toBe(3)
  })

  it('keeps projects with one basename apart', () => {
    expect(projectKey('/a/demo')).not.toBe(projectKey('/b/demo'))
    expect(projectKey('/a/demo')).toMatch(/^demo-[0-9a-f]{12}\.jsonl$/)
  })

  it('names a folder with nothing to slug "project", still keyed by its full path', () => {
    expect(projectKey('/work/...')).toMatch(/^project-[0-9a-f]{12}\.jsonl$/)
    expect(projectKey('/work/...')).not.toBe(projectKey('/other/...'))
  })

  it('reads a project it has never loaded as an empty timeline', async () => {
    const store = await freshStore()
    expect(store.events('/work/never-touched')).toEqual([])
  })

  it('refuses a line that is JSON but no Studio event', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    await appendFile(join(store.root, projectKey(PROJECT)), `${JSON.stringify({ project: PROJECT, seq: 2 })}\n`)

    const reopened = new StudioStore(store.root)
    await expect(reopened.load(PROJECT)).rejects.toThrow('is not a Studio event')
  })

  it('lets the next append run after one that failed', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    await appendFile(join(store.root, projectKey(PROJECT)), 'not json at all\n')

    const reopened = new StudioStore(store.root)
    await expect(reopened.append(message('two'))).rejects.toThrow('the timeline is corrupt')
    // The chain records the failure and carries on, so the next call is judged
    // on its own project rather than inheriting the rejection.
    const other = await reopened.append({ ...message('three'), project: '/work/other' })
    expect(other.event.seq).toBe(1)
  })

  it('lists the projects its timelines name, ignoring everything else in the root', async () => {
    const store = await freshStore()
    await store.append(message('one'))
    await writeFile(join(store.root, 'notes.txt'), 'not a timeline')
    await writeFile(join(store.root, 'headless.jsonl'), '{"project":""}\n')
    await writeFile(join(store.root, 'foreign.jsonl'), 'not json at all\n')
    // A directory named like a timeline cannot be read as one.
    await mkdir(join(store.root, 'directory.jsonl'))

    expect(await store.storedProjects()).toEqual([PROJECT])
  })
})
