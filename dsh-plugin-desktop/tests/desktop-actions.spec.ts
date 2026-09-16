import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import DesktopActionsService, { type DesktopActionsBootstrap } from '../src/desktop-actions.ts'

async function mount(bootstrap: DesktopActionsBootstrap): Promise<{
  readonly ctx: Context
  readonly service: DesktopActionsService
  dispose(): Promise<unknown>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(DesktopActionsService, bootstrap)
  await fiber
  return { ctx, service: ctx.desktopActions as DesktopActionsService, dispose: fiber.dispose }
}

describe('desktop actions Host service', () => {
  it('exposes only no-argument terminal and restart operations', async () => {
    const openTerminal = vi.fn<() => void>()
    const requestRestart = vi.fn<() => Promise<void>>(async () => {})
    const trashItem = vi.fn<(path: string) => Promise<void>>(async () => {})
    const mounted = await mount({ openTerminal, requestRestart, trashItem, collapseToBar: vi.fn(), expandFromBar: vi.fn(), setBarWidth: vi.fn(), focusBar: vi.fn(), notify: vi.fn() })

    mounted.service.openTerminal()
    await expect(mounted.service.requestRestart()).resolves.toBeUndefined()

    expect(openTerminal).toHaveBeenCalledWith()
    expect(requestRestart).toHaveBeenCalledWith()
    await expect(mounted.service.trashItem('/tmp/x')).resolves.toBeUndefined()
    expect(trashItem).toHaveBeenCalledWith('/tmp/x')
    expect(Object.keys(mounted.service).sort()).not.toContain('runCommand')
  })

  it('coalesces a restart request and rejects retained references after disposal', async () => {
    let finishRestart!: () => void
    const requestRestart = vi.fn(() => new Promise<void>(resolve => { finishRestart = resolve }))
    const mounted = await mount({ openTerminal: vi.fn(), requestRestart, trashItem: vi.fn(async () => {}), collapseToBar: vi.fn(), expandFromBar: vi.fn(), setBarWidth: vi.fn(), focusBar: vi.fn(), notify: vi.fn() })

    const first = mounted.service.requestRestart()
    const second = mounted.service.requestRestart()
    expect(second).toBe(first)
    expect(requestRestart).toHaveBeenCalledOnce()
    await mounted.dispose()
    expect(() => mounted.service.openTerminal()).toThrow(/service disposed/u)
    await expect(mounted.service.requestRestart()).rejects.toThrow(/service disposed/u)

    finishRestart()
    await expect(first).resolves.toBeUndefined()
  })

  it('passes a notification through to the launcher, and refuses one after disposal', async () => {
    const notify = vi.fn<(notification: { title: string; body: string }) => void>()
    const mounted = await mount({
      openTerminal: vi.fn(), requestRestart: vi.fn(async () => {}), trashItem: vi.fn(async () => {}),
      collapseToBar: vi.fn(), expandFromBar: vi.fn(), setBarWidth: vi.fn(), focusBar: vi.fn(), notify,
    })

    mounted.service.notify({ title: 'Done', body: 'The render finished.' })
    expect(notify).toHaveBeenCalledWith({ title: 'Done', body: 'The render finished.' })

    await mounted.dispose()
    expect(() => mounted.service.notify({ title: 'Done', body: 'again' })).toThrow(/service disposed/u)
    expect(notify).toHaveBeenCalledOnce()
  })
})
