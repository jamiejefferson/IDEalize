// @vitest-environment jsdom
/**
 * The Files reveal: `revealFile` records the request and opens the Files
 * pane, revealing the same file twice is two requests, and a gallery's
 * `idealize:reveal-artefact` event resolves its project-relative path against
 * the active chat's project root — the workspace holding the chat, or the
 * chat's cwd while the workspace list has not placed it — and is refused,
 * with a warning, while no chat is open.
 */
import { describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { announceArtefact, requestReveal } from '@idealize/artefacts/src/client/reveal.ts'
import { apply, inject } from '../src/client/index.ts'
import { bench, declareRoot, type BenchWorld } from './apply-bench.client.ts'

usePinnedBrowserLanguages('en')

async function booted(world: BenchWorld = {}) {
  const made = await bench(world)
  declareRoot(made.slots)
  const fiber = made.ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ...made, fiber, bar: made.ctx.idealizeBar }
}

describe('ctx.idealizeBar.revealFile', () => {
  it('records the request, opens the Files pane, and counts a repeat as a new request', async () => {
    const { bar, layout } = await booted()
    bar.revealFile('/w/proj/Images/one.png')
    expect(bar.state.getSnapshot().panel).toBe('files')
    expect(bar.state.getSnapshot().reveal).toEqual({ path: '/w/proj/Images/one.png', nonce: 1 })
    expect(layout.openDrawer).toHaveBeenCalledTimes(1)
    bar.revealFile('/w/proj/Images/one.png')
    expect(bar.state.getSnapshot().reveal).toEqual({ path: '/w/proj/Images/one.png', nonce: 2 })
  })
})

describe('a landed artefact', () => {
  it('bumps the Files pane reload counter each time, and stops once the plugin is disposed', async () => {
    const { fiber, bar } = await booted()
    expect(bar.state.getSnapshot().filesReload).toBe(0)
    announceArtefact('Video/2026-09-16_abc.mp4')
    announceArtefact('Video/2026-09-16_def.mp4')
    expect(bar.state.getSnapshot().filesReload).toBe(2)
    await fiber.dispose()
    announceArtefact('Video/2026-09-16_ghi.mp4')
    expect(bar.state.getSnapshot().filesReload).toBe(2)
  })
})

describe('the drawer\'s clearReveal', () => {
  it('drops the pending request once the pane has shown it, and is a no-op with none', async () => {
    const { bar, slots } = await booted()
    const drawer = slots.entries('shell.drawer')[0] as unknown as { inject: () => { clearReveal: () => void } }
    const { clearReveal } = drawer.inject()
    clearReveal()
    expect(bar.state.getSnapshot().reveal).toBeNull()
    bar.revealFile('/w/proj/Images/one.png')
    clearReveal()
    expect(bar.state.getSnapshot().reveal).toBeNull()
    expect(bar.state.getSnapshot().panel).toBe('files')
  })
})

describe('the galleries\' reveal signal', () => {
  it('resolves the path against the workspace holding the active chat', async () => {
    const { bar } = await booted({
      sessions: { current: 's1', ids: ['s1'], byId: { s1: { id: 's1', cwd: '/w/proj/sub' } } },
      workspaces: { items: [{ workspaceId: 'w1', path: '/w/proj', sessionIds: ['s1'] }], archivedSessionIds: [] },
    })
    requestReveal('Images/2026-09-07_abc12345.png')
    expect(bar.state.getSnapshot().reveal).toEqual({ path: '/w/proj/Images/2026-09-07_abc12345.png', nonce: 1 })
    expect(bar.state.getSnapshot().panel).toBe('files')
  })

  it('falls back to the chat\'s cwd while no workspace lists the chat', async () => {
    const { bar } = await booted({
      sessions: { current: 's1', ids: ['s1'], byId: { s1: { id: 's1', cwd: '/w/proj' } } },
    })
    requestReveal('Sounds/tone.wav')
    expect(bar.state.getSnapshot().reveal?.path).toBe('/w/proj/Sounds/tone.wav')
  })

  it('warns and does nothing with no chat open', async () => {
    const { ctx, bar } = await booted()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    requestReveal('Images/x.png')
    expect(warn).toHaveBeenCalledWith('idealize-bar: cannot reveal "Images/x.png" with no project open')
    expect(bar.state.getSnapshot().reveal).toBeNull()
    expect(bar.state.getSnapshot().panel).toBeNull()
  })

  it('stops listening when the fiber goes', async () => {
    const { bar, fiber } = await booted({
      sessions: { current: 's1', ids: ['s1'], byId: { s1: { id: 's1', cwd: '/w/proj' } } },
    })
    await fiber.dispose()
    requestReveal('Images/x.png')
    expect(bar.state.getSnapshot().reveal).toBeNull()
  })
})
