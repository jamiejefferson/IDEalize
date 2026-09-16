/**
 * The host registration: the served index gains the brand sheet, and
 * upstream's first-run notice is pre-acknowledged exactly once — a user who
 * already answered a notice keeps their answer.
 */

import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, OWL_FRAME_STILL, SKIN_STYLE_ID, SPLASH_FRAMES } from '../src/index.ts'

const ONBOARDING_NS = settingsNamespace('ui-onboarding')

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** One host root with the two services the skin may acquire. */
async function mount(stored: Record<string, unknown> | undefined, update: () => Promise<void> = async () => {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const taps: ((html: string) => string)[] = []
  const updates: { namespace: unknown; patch: unknown }[] = []
  ctx.provide('webServer', {
    tapIndex(tap: (html: string) => string) { taps.push(tap); return () => { taps.splice(taps.indexOf(tap), 1) } },
  } as never)
  ctx.provide('settings', {
    get: (namespace: unknown) => (namespace === ONBOARDING_NS ? stored : undefined),
    update: async (namespace: unknown, patch: unknown) => { updates.push({ namespace, patch }); await update() },
  } as never)

  const warnings: unknown[] = []
  ctx.logger.warn = ((...args: unknown[]) => { warnings.push(args[0]) }) as typeof ctx.logger.warn

  const fiber = ctx.plugin({ name: 'idealize-skin', inject: [], apply })
  await fiber.await()
  return { ctx, fiber, taps, updates, warnings }
}

describe('the skin host half', () => {
  it('taps the served index with the brand sheet and gives the tap back on disposal', async () => {
    const { fiber, taps } = await mount({ welcomeNoticeVersion: '2026-08-13.1' })
    expect(taps).toHaveLength(1)
    const html = taps[0]!('<html><body><div id="app"></div></body></html>')
    expect(html).toContain(SKIN_STYLE_ID)
    expect(html).toContain('--idealize-type-title')

    await fiber.dispose()
    expect(taps).toHaveLength(0)
  })

  it('pre-acknowledges upstream’s notice when the user has none stored', async () => {
    const { updates } = await mount(undefined)
    expect(updates).toEqual([{ namespace: ONBOARDING_NS, patch: { welcomeNoticeVersion: '2026-08-13.1' } }])
  })

  it('leaves an answer the user already gave alone', async () => {
    const { updates } = await mount({ welcomeNoticeVersion: '2027-01-01.9' })
    expect(updates).toEqual([])
  })

  it('warns rather than failing the mount when the write is refused', async () => {
    const { warnings } = await mount(undefined, () => Promise.reject(new Error('settings file is read-only')))
    await vi.waitFor(() => { expect(warnings).toEqual(['idealize-skin: welcome-notice pre-ack failed']) })
  })
})

describe('the owl the splash plays', () => {
  it('rests on the first frame of the run cycle', () => {
    expect(SPLASH_FRAMES).toHaveLength(42)
    expect(OWL_FRAME_STILL).toBe(SPLASH_FRAMES[0])
  })
})
