// The bridge forwards a task-list change as a `cron-changed` feed event with
// no payload, so the Schedule pane can refetch.
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { IdealizeBridge } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('the host bridge and the calendar', () => {
  it('pushes one cron-changed event per idealize/cron-changed emit', async () => {
    ctx = new Context()
    await ctx.plugin(IdealizeBridge)
    ctx.emit('idealize/cron-changed')
    ctx.emit('idealize/cron-changed')
    const events = ctx.idealizeBridge.buffer.recent(0)
    expect(events.map(event => [event.seq, event.kind, event.title, event.body])).toEqual([
      [1, 'cron-changed', 'Calendar changed', ''],
      [2, 'cron-changed', 'Calendar changed', ''],
    ])
    expect(events[0]?.sessionId).toBeUndefined()
  })
})
