/**
 * The package's invariant companion registers under the package name and
 * installs nothing, because the plugin owns no event stream. This suite owns
 * its service topology (the file name opts out of the global invariant host).
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as TelegramInvariant from '../src/invariant.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

describe('the telegram invariant companion', () => {
  it('registers under the package name with an installer that reports nothing', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const registered: string[] = []
    let installer: ((child: Context, fail: (message: string) => never) => void) | undefined
    ctx.provide('invariants', {
      register(name: string, install: (child: Context, fail: (message: string) => never) => void) {
        registered.push(name)
        installer = install
        return () => {}
      },
    })
    await ctx.plugin(TelegramInvariant)
    await ctx.fiber.await()
    const reported: string[] = []
    installer?.(ctx, ((message: string) => { reported.push(message) }) as (message: string) => never)
    expect(registered).toEqual(['@idealize/telegram'])
    expect(reported).toEqual([])
  })
})
