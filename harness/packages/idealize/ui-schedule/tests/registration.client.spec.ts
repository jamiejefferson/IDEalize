// @vitest-environment jsdom
/**
 * Real tsdown artifact: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, and a mounted apply publishes the `scheduleSection` service without
 * touching the conversation view ring, with disposal taking the service back
 * (AC-47's seat moved: the registration's disposer was the tab's lifecycle;
 * the service provision's is the pane's). Skips when lib/ is not built
 * (`pnpm --filter @idealize/ui-schedule bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@idealize/ui-schedule'

/**
 * Evaluating the real bundle, importing React and the client runtime, and
 * booting a Cordis context takes about five seconds on a quiet machine —
 * past the default while the rest of the suite runs beside it.
 */
const ARTIFACT_TIMEOUT_MS = 30_000

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    // import.meta.url is http-scheme in the jsdom pool; vitest runs from the
    // repo root, so resolve the artifact repo-relatively instead.
    return readFileSync(resolve('packages/idealize/ui-schedule/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('the Schedule client artifact', () => {
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
    expect(exports.inject).toEqual(['locale', 'sessions', 'workspaces'])
  }, ARTIFACT_TIMEOUT_MS)

  it.skipIf(code === undefined)('publishes the calendar service and leaves the view ring alone', async () => {
    const { exports } = await loadArtifact()
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    // The conversation entry's role in the app: the ring is declared before
    // riders land. This plugin must register none.
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('sessions', { binding: () => undefined, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } } as never)
    ctx.provide('workspaces', { list: { getSnapshot: () => ({ items: [] }) } } as never)
    // The locale plugin's own dependencies; without them it never applies and
    // this plugin (which injects `locale`) never reaches its registration.
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    ctx.plugin({ inject: [...locale.inject], apply: locale.apply })

    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    await fiber.await()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(ctx.get('scheduleSection')).toBeDefined()

    // The provision's disposer IS the pane's lifecycle.
    await fiber.dispose()
    expect(ctx.get('scheduleSection')).toBeUndefined()
  }, ARTIFACT_TIMEOUT_MS)

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  }, ARTIFACT_TIMEOUT_MS)
})
