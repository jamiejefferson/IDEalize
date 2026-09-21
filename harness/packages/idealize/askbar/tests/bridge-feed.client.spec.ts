// @vitest-environment jsdom
// The window's one bridge feed connection: several followers share a single
// EventSource and a single tail read, each hears only what came after it
// attached, a replayed event is delivered once, and the connection closes
// with its last follower.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeBridgeFeed, followBridgeFeed } from '../src/client/bridge-feed.ts'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((message: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) { FakeEventSource.instances.push(this) }
  close(): void { this.closed = true }
  send(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

function stub(tail: unknown, fail = false) {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  const fetchMock = vi.fn(async () => {
    if (fail) throw new Error('offline')
    return { ok: true, json: async () => tail }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  closeBridgeFeed()
  vi.unstubAllGlobals()
})

describe('followBridgeFeed', () => {
  it('serves every follower from one tail read and one stream opened past the tail', async () => {
    const fetchMock = stub([{ seq: 4, kind: 'notify' }, { seq: 7, kind: 'open-folder' }])
    const first: number[] = []
    const second: number[] = []
    const [a, b] = await Promise.all([
      followBridgeFeed(event => first.push(event.seq)),
      followBridgeFeed(event => second.push(event.seq)),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.instances.map(source => source.url)).toEqual(['/idealize/events/stream?since=7'])
    expect(a?.tail.map(event => event.seq)).toEqual([4, 7])
    expect(b?.tail.map(event => event.seq)).toEqual([4, 7])
    FakeEventSource.instances[0]!.send({ seq: 8, kind: 'agent-finished' })
    expect(first).toEqual([8])
    expect(second).toEqual([8])
  })

  it('hands a late follower what arrived before it as tail, and only later events live', async () => {
    stub([])
    const early: number[] = []
    await followBridgeFeed(event => early.push(event.seq))
    const source = FakeEventSource.instances[0]!
    source.send({ seq: 1 })
    const late: number[] = []
    const attachment = await followBridgeFeed(event => late.push(event.seq))
    expect(attachment?.tail.map(event => event.seq)).toEqual([1])
    source.send({ seq: 2 })
    expect(early).toEqual([1, 2])
    expect(late).toEqual([2])
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('delivers an event once when a reconnect replays it, and drops a malformed frame', async () => {
    stub([])
    const heard: number[] = []
    await followBridgeFeed(event => heard.push(event.seq))
    const source = FakeEventSource.instances[0]!
    source.send({ seq: 1 })
    source.send({ seq: 1 })
    source.onmessage?.({ data: ': keep-alive' })
    source.send({ seq: 2 })
    expect(heard).toEqual([1, 2])
  })

  it('keeps one follower’s failure from the others', async () => {
    stub([])
    const heard: number[] = []
    await followBridgeFeed(() => { throw new Error('boom') })
    await followBridgeFeed(event => heard.push(event.seq))
    FakeEventSource.instances[0]!.send({ seq: 1 })
    expect(heard).toEqual([1])
  })

  it('closes the connection with its last follower, and opens a fresh one afterwards', async () => {
    stub([])
    const a = await followBridgeFeed(() => {})
    const b = await followBridgeFeed(() => {})
    const source = FakeEventSource.instances[0]!
    a?.close()
    expect(source.closed).toBe(false)
    b?.close()
    expect(source.closed).toBe(true)
    await followBridgeFeed(() => {})
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('answers undefined when the bridge is absent, and tries again for the next follower', async () => {
    stub([], true)
    expect(await followBridgeFeed(() => {})).toBeUndefined()
    expect(FakeEventSource.instances).toHaveLength(0)
    stub([{ seq: 3 }])
    const attachment = await followBridgeFeed(() => {})
    expect(attachment?.tail.map(event => event.seq)).toEqual([3])
  })

  it('reads a body that is not a list as an empty tail', async () => {
    stub({ not: 'a list' })
    const attachment = await followBridgeFeed(() => {})
    expect(attachment?.tail).toEqual([])
    expect(FakeEventSource.instances[0]!.url).toBe('/idealize/events/stream?since=0')
  })
})
