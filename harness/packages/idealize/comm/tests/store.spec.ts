import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommStore, commStorePath, parseCommState } from '../src/store.ts'
import type { CommState } from '../src/store.ts'

async function scratchStore(): Promise<CommStore> {
  const home = await mkdtemp(join(tmpdir(), 'idealize-comm-spec-'))
  return new CommStore(commStorePath(home))
}

const message = (body: string) => ({ from: 't-a', body, timestamp: '2026-08-20T01:02:03.000Z' })

describe('CommStore', () => {
  it('queues, peeks, counts, and drains a mailbox durably', async () => {
    const store = await scratchStore()
    await store.deliver('t-b', message('one'))
    await store.deliver('t-b', message('two'))
    expect(store.unread('t-b')).toBe(2)
    expect(store.peek('t-b').map(item => item.body)).toEqual(['one', 'two'])
    expect(store.unread('t-b')).toBe(2)

    const reopened = new CommStore(store.path)
    await reopened.load()
    expect(reopened.unread('t-b')).toBe(2)

    expect((await reopened.drain('t-b')).map(item => item.body)).toEqual(['one', 'two'])
    expect(reopened.unread('t-b')).toBe(0)
    expect((JSON.parse(await readFile(store.path, 'utf8')) as CommState).mailboxes).toEqual({})
  })

  it('keeps rungs, statuses, roles, and names across a reload', async () => {
    const store = await scratchStore()
    await store.setRung('t-a', { piece: 'hero', rung: 'saved', blocker: 'none', session: 't-a', updated: '2026-08-20T00:00:00.000Z' })
    await store.setStatus('t-a', 'running tests')
    await store.setRole('t-a', 'project-agent')
    await store.setName('t-a', 'Hero')
    const reopened = new CommStore(store.path)
    await reopened.load()
    expect(reopened.rungs()).toHaveLength(1)
    expect(reopened.status('t-a')).toBe('running tests')
    expect(reopened.roles()).toEqual({ 't-a': 'project-agent' })
    expect(reopened.name('t-a')).toBe('Hero')
    await reopened.setStatus('t-a', undefined)
    await reopened.setRole('t-a', undefined)
    expect(reopened.status('t-a')).toBeUndefined()
    expect(reopened.role('t-a')).toBeUndefined()
  })

  it('serialises a burst of deliveries into one consistent document', async () => {
    const store = await scratchStore()
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.deliver('t-b', message(`m${i}`))))
    const reopened = new CommStore(store.path)
    await reopened.load()
    expect(reopened.unread('t-b')).toBe(20)
  })
})

describe('parseCommState', () => {
  it('drops malformed sections and survives non-JSON', () => {
    expect(parseCommState('nope').mailboxes).toEqual({})
    expect(parseCommState('[]').rungs).toEqual({})
    const parsed = parseCommState(JSON.stringify({
      mailboxes: { ok: [message('x')], bad: [{ nope: 1 }] },
      roles: { a: 'lead', b: 'project-agent', c: 'king' },
      statuses: { a: 'busy', b: 3 },
      rungs: 'no',
    }))
    expect(Object.keys(parsed.mailboxes)).toEqual(['ok'])
    // The retired 'lead' role is dropped on load, like any unknown role.
    expect(parsed.roles).toEqual({ b: 'project-agent' })
    expect(parsed.statuses).toEqual({ a: 'busy' })
    expect(parsed.rungs).toEqual({})
  })

  it('reads a mailbox nobody ever wrote as empty, and drains it without writing', async () => {
    const store = await scratchStore()
    await store.load()
    expect(store.peek('t-unknown')).toEqual([])
    expect(await store.drain('t-unknown')).toEqual([])
    // Nothing was written, so the document is still the empty one.
    const reopened = new CommStore(store.path)
    await reopened.load()
    expect(reopened.peek('t-unknown')).toEqual([])
  })

  it('records a task title and gives it back after a reopen', async () => {
    const store = await scratchStore()
    await store.setTitle('t-a', 'Wire up the Studio')
    const reopened = new CommStore(store.path)
    await reopened.load()
    expect(reopened.title('t-a')).toBe('Wire up the Studio')
  })

  it('keeps a stored pool index and drops one that is not a whole count', () => {
    const parsed = parseCommState(JSON.stringify({
      pools: { '/p/alpha': 3, '/p/beta': -1, '/p/gamma': 1.5, '/p/delta': 'two' },
    }))
    expect(parsed.pools).toEqual({ '/p/alpha': 3 })
  })
})
