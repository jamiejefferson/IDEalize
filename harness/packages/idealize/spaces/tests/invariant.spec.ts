/**
 * The package's invariant companion: an `idealize/space` record must name a
 * space this build declares, because the id drives the view ring, the sidebar
 * lane and the availability read.
 *
 * `session/event` listeners are contained by the session store, so a violation
 * surfaces as the store's warning carrying the InvariantError rather than by
 * throwing out of `append`.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import * as SpacesInvariant from '../src/invariant.ts'

/** A context whose invariant child fiber has finished installing its listener. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SpacesInvariant)
  await ctx.fiber.await()
  return ctx
}

describe('the spaces invariant companion', () => {
  it('says nothing about a record naming a declared space', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    session.append('idealize/space', { space: 'motion' }, { ignorable: true })

    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a record naming a space this build does not declare', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    session.append('idealize/space', { space: 'trajectory' } as never, { ignorable: true })

    expect(warn.mock.calls.flat().join('\n')).toContain(
      'invariant violated by "@idealize/spaces": idealize/space recorded \'trajectory\', '
      + 'which is not one of the declared spaces: chat, terminal, gallery, soundstage, motion',
    )
  })

  it('ignores every other event type', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    session.append('idealize/brain', { brain: 'coding' }, { ignorable: true })

    expect(warn).not.toHaveBeenCalled()
  })

  it('reserves the package name against duplicate registration', async () => {
    const ctx = await harness()

    expect(() => { ctx.invariants.register('@idealize/spaces', () => {}) }).toThrow(/already registered/)
  })
})
