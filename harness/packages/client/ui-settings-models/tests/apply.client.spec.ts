/** Onboarding registration + invalidation wiring. (IDEalize fork: the Models
 * page itself no longer registers a settings section — it renders in the
 * bar's Models & usage drawer, which builds its own store and face.) */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, refreshIfLoaded } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { DeepSeekOnboardingDialog } from '../src/client/DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  // The apply path only captures the wire face; no call leaves this fake
  // until a section actually loads.
  ctx.provide('connection', { api: {}, isLoopback } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-models apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
  })

  it('registers the onboarding dialogs and no settings section (fork shape)', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    // The Models page renders in the bar's drawer, not the settings modal.
    expect(before.slots.entries('settings.section')).toHaveLength(0)
    const onboarding = before.slots.entries('settings.onboarding')
    expect(onboarding).toHaveLength(2)
    expect(onboarding.find(entry => entry.options.id === 'welcome-notice')).toMatchObject({
      component: WelcomeNotice,
      options: { id: 'welcome-notice', order: -100 },
    })
    const deepSeek = onboarding.find(entry => entry.options.id === 'deepseek-official')!
    expect(deepSeek.component).toBe(DeepSeekOnboardingDialog)
    expect(deepSeek.options).toMatchObject({ id: 'deepseek-official', order: 0 })
    const deepSeekInjected = (
      deepSeek.inject as unknown as () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    expect(deepSeekInjected.hooks.models).toBeDefined()
    expect(deepSeekInjected.api).toBeDefined()
    expect(deepSeekInjected.t('nav')).toBe('模型')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(2)
  })

  it('locale change while the slot is undeclared stays a no-op', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    b.locale.setLocale('zh')
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.onboarding')).toHaveLength(2)
    // Declarer unload: the cascade removes our entries while our local
    // disposer variables go stale.
    redeclare()
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.onboarding')).toHaveLength(2)
  })

  it('registers the zh/en nav dictionaries and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.models')('nav')).toBe('模型')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    // The (ns, locale) seats are free again — the dictionary disposers ran.
    expect(() => b.locale.register('settings.models', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings.models', 'en', {})).not.toThrow()
  })

  it('keeps remote-browser acknowledgement in process memory', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()

    await injected.controller.load()
    expect(injected.controller.store.getSnapshot()).toEqual({
      status: 'ready', acknowledged: false, error: null,
    })
  })
})

describe('pushed invalidations', () => {
  it('ignores invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The fake wire face has no methods: a fetch attempt would throw.
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    b.ctx.remote.$dispatch('credentials/updated', ['OPENAI_API_KEY'])
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
  })

  it('routes pushed credential invalidation into the shared onboarding join', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'deepseek-official')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/DeepSeekOnboardingDialog.tsx').DeepSeekOnboardingInjected
    )()
    injected.controller.store.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()
    b.ctx.remote.$dispatch('credentials/updated', ['DEEPSEEK_API_KEY'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('routes only the onboarding namespace invalidation into welcome state', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()
    injected.hooks.welcome.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()

    b.ctx.remote.$dispatch('settings/document-updated', ['llm-deepseek', 1])
    expect(load).not.toHaveBeenCalled()
    b.ctx.remote.$dispatch('settings/document-updated', ['ui-onboarding', 2])
    expect(load).toHaveBeenCalledOnce()
    b.ctx.emit('connection/reset')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
