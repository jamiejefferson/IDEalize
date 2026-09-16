// @vitest-environment jsdom
/**
 * Real tsdown artifact: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, and a mounted apply registers the Gallery Definition, its view
 * target, the `gallery` ring entry, and — once the chat view entry exists to
 * share its store with — the composer's settings row, on a real SlotRegistry,
 * with disposal taking them all back. Skips when lib/ is not built
 * (`pnpm --filter @idealize/ui-gallery bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ConversationEventRegistry, ConversationViewRegistry, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@idealize/ui-gallery'

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    // import.meta.url is http-scheme in the jsdom pool; vitest runs from the
    // repo root, so resolve the artifact repo-relatively instead.
    return readFileSync(resolve('packages/idealize/ui-gallery/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

// The spec mounts the built lib/client.js bundle; under a loaded machine the mount
// outruns the 5 s default (pre-existing timing, 8 Sep 2026).
describe('the Gallery client artifact', { timeout: 30_000 }, () => {
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
    expect(exports.inject).toEqual(['slots', 'conversationEvents', 'conversationViews', 'locale', 'sessions'])
  })

  /** A root context with the two slots the Gallery fills already declared. */
  async function mountHost() {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    await ctx.plugin(ConversationEventRegistry).await()
    await ctx.plugin(ConversationViewRegistry).await()
    // The conversation entry's role: the ring and the composer dock must be
    // declared before riders land.
    slots.register({
      name: 'root',
      children: {
        'conversation.view': { kind: 'list', scope: 'session' },
        'conversation.input.left': { kind: 'list', scope: 'session' },
      },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('sessions', { binding: () => undefined })
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    ctx.plugin({ inject: [...locale.inject], apply: locale.apply })
    return { ctx, slots }
  }

  /** Stand in for ui-conversation's chat ring entry: the store the settings row shares. */
  function registerChatEntry(slots: SlotRegistry): () => void {
    return slots.register(
      { name: 'conversation.view', id: 'chat', order: 0, store: { scope: 'session' } } as never,
      (() => null) as never,
    )
  }

  it.skipIf(code === undefined)('registers both ring entries, the Definition and the view target, and gives them all back on disposal', async () => {
    const { exports } = await loadArtifact()
    const { ctx, slots } = await mountHost()

    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()
    const events = ctx.get('conversationEvents') as ConversationEventRegistry
    const views = ctx.get('conversationViews') as ConversationViewRegistry
    // Two ring entries over one Definition: Images and Video are the same grid
    // filtered to their own kind, so `motion` needs no package of its own.
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['gallery', 'motion'])
    expect(events.entries().length).toBeGreaterThan(0)
    expect(views.entries()).toHaveLength(1)

    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(slots.entries('conversation.input.left')).toHaveLength(0)
    expect(events.entries()).toEqual([])
    expect(views.entries()).toEqual([])
  })

  it.skipIf(code === undefined)('lands the composer controls on the tool row over the chat entry\'s store, whenever that entry appears', async () => {
    const { exports } = await loadArtifact()
    const { ctx, slots } = await mountHost()

    // Applied before ui-conversation declares the ring: the controls wait.
    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()
    expect(slots.entries('conversation.input.left')).toHaveLength(0)

    const dropChat = registerChatEntry(slots)
    // The registry batches slot notifications onto a microtask.
    await Promise.resolve()
    const left = slots.entries('conversation.input.left')
    expect(left.map(entry => entry.options.id)).toEqual(['idealize-gallery-settings'])
    expect(left[0]?.store).toBeDefined()

    dropChat()
    await fiber.dispose()
    expect(slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  })
})
