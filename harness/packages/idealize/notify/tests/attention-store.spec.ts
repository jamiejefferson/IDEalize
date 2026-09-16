/**
 * The read-position and notification-delivery records on disk: what survives
 * a restart, what a second raise of one event does, and what an unreadable
 * ledger does rather than quietly starting empty over the top of it.
 */

import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttentionStore, attentionLedgerPath } from '../src/attention-store.ts'
import type { AttentionLedger } from '../src/attention-store.ts'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function ledgerPath(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'idealize-notify-attention-'))
  homes.push(home)
  return attentionLedgerPath(home)
}

async function seed(text: string): Promise<string> {
  const path = await ledgerPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}

const alert = (event: string) => ({ event, project: '/work/demo', row: 'needs-input' as const })

describe('the attention ledger', () => {
  it('starts empty when nothing has been recorded', async () => {
    const store = new AttentionStore(await ledgerPath())
    expect(await store.load()).toEqual({ read: {}, notifications: [] })
  })

  it('moves a read position forward and never back', async () => {
    const path = await ledgerPath()
    const store = new AttentionStore(path)
    expect(await store.markRead('/work/demo', 4)).toBe(4)
    // A slower view settling after a newer one must not re-unread what was seen.
    expect(await store.markRead('/work/demo', 2)).toBe(4)
    expect(await store.markRead('/work/other', 1)).toBe(1)
    // A project nobody has read to answers with the position it has: none.
    expect(await store.markRead('/work/fresh', 0)).toBe(0)
    // A restart reads the same positions.
    expect((await new AttentionStore(path).load()).read).toEqual({ '/work/demo': 4, '/work/other': 1 })
  })

  it('records one alert per event and keeps the first record', async () => {
    const store = new AttentionStore(await ledgerPath())
    const first = await store.recordSent(alert('se-1'))
    expect(first).toMatchObject({ raised: true, record: { event: 'se-1', state: 'sent', row: 'needs-input' } })
    const again = await store.recordSent({ ...alert('se-1'), row: 'mention' })
    expect(again.raised).toBe(false)
    expect(again.record.row).toBe('needs-input')
    expect((await store.load()).notifications).toHaveLength(1)
  })

  it('records what the person did with an alert, and nothing for an event that never alerted', async () => {
    const path = await ledgerPath()
    const store = new AttentionStore(path)
    await store.recordSent(alert('se-1'))
    const dismissed = await store.markState('se-1', 'dismissed')
    expect(dismissed).toMatchObject({ state: 'dismissed' })
    expect(dismissed?.changedAt).toBeTypeOf('string')
    expect(await store.markState('se-unknown', 'opened')).toBeUndefined()
    expect((await new AttentionStore(path).load()).notifications[0]?.state).toBe('dismissed')
  })

  it('keeps the newest records and leaves no half-written file behind', async () => {
    const path = await ledgerPath()
    const store = new AttentionStore(path)
    for (let index = 0; index < 505; index += 1) await store.recordSent(alert(`se-${String(index)}`))
    const ledger = await store.load()
    expect(ledger.notifications).toHaveLength(500)
    expect(ledger.notifications[0]?.event).toBe('se-5')
    expect(await readdir(dirname(path))).toEqual(['attention.json'])
    expect(JSON.parse(await readFile(path, 'utf8')) as AttentionLedger).toEqual(ledger)
  })

  it('serialises concurrent writes rather than losing one', async () => {
    const store = new AttentionStore(await ledgerPath())
    await Promise.all([
      store.recordSent(alert('se-1')),
      store.recordSent(alert('se-2')),
      store.markRead('/work/demo', 9),
    ])
    const ledger = await store.load()
    expect(ledger.notifications.map(record => record.event)).toEqual(['se-1', 'se-2'])
    expect(ledger.read).toEqual({ '/work/demo': 9 })
  })

  it('refuses an unreadable ledger instead of starting empty over it', async () => {
    const cases: [string, string][] = [
      ['{not json', 'is not JSON'],
      ['"a string"', 'is not an attention ledger'],
      ['null', 'is not an attention ledger'],
      ['{"read": [], "notifications": []}', 'carries no read positions'],
      ['{"read": {"/work/demo": 1.5}, "notifications": []}', 'is not a seq'],
      ['{"read": {}, "notifications": {}}', 'malformed notification record'],
      ['{"read": {}, "notifications": ["nope"]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [null]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [{"event": "se-1"}]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [{"event": "se-1", "project": "/p"}]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [{"event": "se-1", "project": "/p", "row": "mention"}]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [{"event": "se-1", "project": "/p", "row": "mention", "at": "now"}]}', 'malformed notification record'],
      ['{"read": {}, "notifications": [{"event": "se-1", "project": "/p", "row": "mention", "at": "now", "state": "shrugged"}]}', 'malformed notification record'],
    ]
    for (const [text, message] of cases) {
      const store = new AttentionStore(await seed(text))
      await expect(store.load()).rejects.toThrow(message)
    }
  })

  it('reads the file once and answers later calls from what it holds', async () => {
    const path = await seed('{"read": {"/work/demo": 3}, "notifications": []}')
    const store = new AttentionStore(path)
    expect((await store.load()).read).toEqual({ '/work/demo': 3 })
    await rm(path)
    expect((await store.load()).read).toEqual({ '/work/demo': 3 })
  })
})
