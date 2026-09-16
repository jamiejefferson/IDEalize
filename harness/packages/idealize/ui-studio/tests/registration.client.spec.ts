// @vitest-environment jsdom
/**
 * Real tsdown artifact: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, and a mounted apply publishes the `studioSection` service, seats
 * the ring entry and the `@` agents source, with disposal taking them back.
 * Skips when lib/ is not built (`pnpm --filter @idealize/ui-studio bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@idealize/ui-studio'

/** Evaluating the real bundle and booting Cordis outruns the default timeout. */
const ARTIFACT_TIMEOUT_MS = 30_000

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    // import.meta.url is http-scheme in the jsdom pool; vitest runs from the
    // repo root, so resolve the artifact repo-relatively instead.
    return readFileSync(resolve('packages/idealize/ui-studio/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('the Studio client artifact', () => {
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
      ['@deepseek-ai/dsh-client-web-react', await import('@deepseek-ai/dsh-client-web-react')],
      ['@deepseek-ai/dsh-client-ui-primitives', await import('@deepseek-ai/dsh-client-ui-primitives')],
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
    expect(exports.inject).toEqual(['slots', 'locale', 'sessions', 'conversation', 'inputTriggers'])
  }, ARTIFACT_TIMEOUT_MS)

  it.skipIf(code === undefined)('publishes the section service and seats the studio view in the ring', async () => {
    const { exports } = await loadArtifact()
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    // The conversation entry's role in the app: the ring is declared before
    // riders land.
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('sessions', {
      open: () => {},
      list: {
        getSnapshot: () => ({
          byId: {
            's1': { cwd: '/w/alpha', projectionValues: { agentName: { name: 'Mas Amedda' } } },
            's2': { cwd: '/w/beta/deep', projectionValues: { agentName: { name: 'Kit Fisto' } } },
            's3': { cwd: '/w/alpha' },
          },
          current: undefined,
        }),
        subscribe: () => () => {},
      },
    } as never)
    ctx.provide('conversation', { revealAt: () => {} } as never)
    interface SourceLike {
      trigger: string
      name: string
      candidates: (s: unknown, r: { query: string }) => Promise<{ name: string; hint?: string }[]>
      onPick: (p: unknown) => unknown
      lexicon: () => string[]
    }
    const sources: SourceLike[] = []
    ctx.provide('inputTriggers', { registerSource: (source: never) => { sources.push(source); return () => { sources.length = 0 } } } as never)
    // The locale plugin's own dependencies; without them it never applies and
    // this plugin (which injects `locale`) never reaches its registration.
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    ctx.plugin({ inject: [...locale.inject], apply: locale.apply })

    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void; inject: string[] })
    await fiber.await()
    const ring = slots.entries('conversation.view')
    expect(ring.map(entry => entry.options.id)).toEqual(['studio'])
    const section = ctx.get('studioSection') as { store: { state: unknown } } | undefined
    expect(section?.store.state).toBeDefined()

    // The `@` source lists every named chat, the project as the hint, and inserts the address.
    expect(sources.map(source => [source.trigger, source.name])).toEqual([['@', 'Agents']])
    const source = sources[0]!
    expect(await source.candidates(undefined, { query: '' })).toEqual([
      { name: 'Kit Fisto', hint: 'deep' },
      { name: 'Mas Amedda', hint: 'alpha' },
    ])
    expect(await source.candidates(undefined, { query: 'kit' })).toEqual([{ name: 'Kit Fisto', hint: 'deep' }])
    expect(source.lexicon()).toEqual(['Kit Fisto', 'Mas Amedda'])
    expect(source.onPick({ candidate: { name: 'Kit Fisto' } })).toEqual({ text: '@Kit Fisto ' })

    // The provision's disposer IS the view's lifecycle: the ring entry and the source leave with it.
    await fiber.dispose()
    expect(ctx.get('studioSection')).toBeUndefined()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(sources).toHaveLength(0)
  }, ARTIFACT_TIMEOUT_MS)

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  }, ARTIFACT_TIMEOUT_MS)
})
