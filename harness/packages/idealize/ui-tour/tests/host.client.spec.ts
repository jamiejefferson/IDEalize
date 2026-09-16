/**
 * The tour's host half owns one durable settings section: the seed that keeps
 * the first-run showcase from replaying. Its schema takes a boolean and
 * refuses anything else, so a corrupt file cannot silently reset the tour.
 */

import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type Schema from '@deepseek-ai/schemastery'
import { afterEach, describe, expect, it } from 'vitest'
import type { TourSettings } from '@idealize/ui-tour'
import { apply, TOUR_SETTINGS_NAMESPACE } from '@idealize/ui-tour'

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

describe('the tour host face', () => {
  it('registers the tour section under its shared namespace', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const sections: { namespace: unknown; schema: Schema<TourSettings> }[] = []
    ctx.provide('settings', {
      register(namespace: unknown, schema: Schema<TourSettings>) { sections.push({ namespace, schema }); return () => {} },
    } as never)

    await ctx.plugin({ name: '@idealize/ui-tour', inject: [], apply }).await()

    expect(sections).toHaveLength(1)
    expect(sections[0]?.namespace).toBe(settingsNamespace(TOUR_SETTINGS_NAMESPACE))
    expect(sections[0]?.schema({ hasSeenTour: true })).toEqual({ hasSeenTour: true })
    expect(() => sections[0]?.schema({ hasSeenTour: 'yes' } as never)).toThrow()
  })
})
