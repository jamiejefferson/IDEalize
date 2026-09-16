// @vitest-environment jsdom
/**
 * Real tsdown artifact: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, and a mounted apply takes the frame's aside seat on a real
 * SlotRegistry, with disposal giving it back. Skips when lib/ is not built
 * (`pnpm --filter @idealize/ui-tasks bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@idealize/ui-tasks'

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    // import.meta.url is http-scheme in the jsdom pool; vitest runs from the
    // repo root, so resolve the artifact repo-relatively instead.
    return readFileSync(resolve('packages/idealize/ui-tasks/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('the task column client artifact', () => {
  const code = readBundle()

  async function loadArtifact() {
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: (h) => { handoff = h } }
    // The implied-eval ban targets accidental string execution, not this
    // deliberate built-bundle fixture running in the window scope.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff).toBeDefined()
    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-runtime/client', await import('@deepseek-ai/dsh-client-runtime/client')],
    ])
    const exports = handoff!.factory((spec) => {
      if (!modules.has(spec)) throw new Error(`unexpected require: ${spec}`)
      return modules.get(spec)
    })
    return { handoff: handoff!, exports }
  }

  it.skipIf(code === undefined)('hands off with the manifest id and a DI-require factory', async () => {
    const { handoff, exports } = await loadArtifact()
    expect(handoff.id).toBe(PLUGIN_ID)
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['slots', 'locale'])
  })

  /** A root context with the frame's aside seat already declared. */
  async function mountHost() {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    slots.register({
      name: 'root',
      children: {
        'shell.aside': { kind: 'single', scope: 'session-maybe' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
      },
    }, (_p: { renderSlot?: unknown }) => null)
    // What the locale plugin itself injects; this package reads only its bind.
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    // Awaited: this package injects `locale`, so mounting it before the
    // service lands leaves the fiber pending and the seat empty.
    await ctx.plugin({ inject: [...locale.inject], apply: locale.apply }).await()
    return { ctx, slots }
  }

  it.skipIf(code === undefined)('takes the aside seat and gives it back on disposal', async () => {
    const { exports } = await loadArtifact()
    const { ctx, slots } = await mountHost()

    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()
    // The registry batches slot notifications onto a microtask, and the
    // artifact's own module graph settles a tick behind the fiber under load.
    await vi.waitFor(() => { expect(slots.entries('shell.aside')).toHaveLength(1) })
    // The composer's plan strip cell is taken by an empty occupant below the strip's priority.
    await vi.waitFor(() => { expect(slots.entries('conversation.input.dock')).toHaveLength(1) })
    expect(slots.entries('conversation.input.dock')[0]?.options).toMatchObject({ id: 'todo', priority: -1 })

    await fiber.dispose()
    await vi.waitFor(() => { expect(slots.entries('shell.aside')).toHaveLength(0) })
    await vi.waitFor(() => { expect(slots.entries('conversation.input.dock')).toHaveLength(0) })
  })
})
