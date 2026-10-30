import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopQuitGuard,
  type DesktopPauseService,
  type DesktopPauseSnapshot,
  type DesktopQuitQuestion,
} from '../src/quit-guard.ts'

/** A harness pause the test moves by hand, telling its listeners on each move. */
function fakePause(start: DesktopPauseSnapshot) {
  let current = start
  const listeners = new Set<() => void>()
  const move = (next: Partial<DesktopPauseSnapshot>): void => {
    current = { ...current, ...next }
    for (const listener of listeners) listener()
  }
  const service: DesktopPauseService & { listeners: Set<() => void> } = {
    listeners,
    snapshot: vi.fn(() => Promise.resolve(current)),
    pause: vi.fn(() => {
      current = { ...current, phase: current.working === 0 ? 'paused' : 'saving', saving: current.working, working: 0 }
      return Promise.resolve(current)
    }),
    stopNow: vi.fn(() => {
      current = { ...current, phase: 'paused', saving: 0 }
      return Promise.resolve(current)
    }),
    onChange: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return { service, move }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function guard(service: DesktopPauseService | undefined, answers: number[], locale: 'en' | 'zh' = 'en') {
  const asked: DesktopQuitQuestion[] = []
  const quit = vi.fn()
  const show = vi.fn()
  const warn = vi.fn()
  const quitGuard = createDesktopQuitGuard({
    pause: () => service,
    ask: (question) => {
      asked.push(question)
      return Promise.resolve(answers.shift() ?? question.cancelId)
    },
    show,
    quit,
    locale: () => locale,
    warn,
  })
  return { quitGuard, asked, quit, show, warn }
}

describe('the quit guard (feedback 495cec0a)', () => {
  it('quits at once before the Host is up, with nobody working, and when every agent is paused', async () => {
    for (const service of [
      undefined,
      fakePause({ phase: 'running', saving: 0, working: 0 }).service,
      fakePause({ phase: 'paused', saving: 0, working: 0 }).service,
    ]) {
      const { quitGuard, asked, quit } = guard(service, [])
      await quitGuard.request()
      expect(asked).toEqual([])
      expect(quit).toHaveBeenCalledOnce()
    }
  })

  it('asks while agents work, and Pause and Quit shows the window and quits once every agent has saved its notes', async () => {
    const { service, move } = fakePause({ phase: 'running', saving: 0, working: 3 })
    const { quitGuard, asked, quit, show } = guard(service, [0])
    await quitGuard.request()
    expect(asked[0]).toEqual({
      message: '3 agents are still working.',
      detail: 'Pausing first lets each agent write where it got to into the project\'s notes, so Resume can pick the work up when you next open IDEalize.',
      buttons: ['Pause and Quit', 'Quit Anyway', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    expect(service.pause).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledOnce()
    await flush()
    expect(quit).not.toHaveBeenCalled()
    move({ saving: 1 })
    await flush()
    expect(quit).not.toHaveBeenCalled()
    move({ phase: 'paused', saving: 0 })
    await flush()
    expect(quit).toHaveBeenCalledOnce()
    expect(service.listeners.size).toBe(0)
    // A quit after the guard let one through escalates as before.
    await quitGuard.request()
    expect(quit).toHaveBeenCalledTimes(2)
  })

  it('quits on Quit Anyway, stays on Cancel, and asks once however often Quit is pressed', async () => {
    const { service } = fakePause({ phase: 'running', saving: 0, working: 1 })
    const stay = guard(service, [2])
    await Promise.all([stay.quitGuard.request(), stay.quitGuard.request()])
    expect(stay.asked).toHaveLength(1)
    expect(stay.asked[0]?.message).toBe('1 agent is still working.')
    expect(stay.quit).not.toHaveBeenCalled()
    expect(service.pause).not.toHaveBeenCalled()

    const leave = guard(service, [1])
    await leave.quitGuard.request()
    expect(leave.quit).toHaveBeenCalledOnce()
    expect(service.pause).not.toHaveBeenCalled()
  })

  it('offers Stop Now and Quit while agents save their notes, and Cancel keeps the app open', async () => {
    const { service } = fakePause({ phase: 'saving', saving: 2, working: 0 })
    const stay = guard(service, [2])
    await stay.quitGuard.request()
    expect(stay.asked[0]).toMatchObject({
      message: '2 agents are still saving notes.',
      buttons: ['Quit When Paused', 'Stop Now and Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    })
    expect(stay.quit).not.toHaveBeenCalled()

    const leave = guard(service, [1])
    await leave.quitGuard.request()
    expect(service.stopNow).toHaveBeenCalledOnce()
    expect(leave.quit).toHaveBeenCalledOnce()
  })

  it('lets a second Quit cut the wait, and drops the quit when Resume is pressed meanwhile', async () => {
    const { service } = fakePause({ phase: 'running', saving: 0, working: 2 })
    const cut = guard(service, [0, 1])
    await cut.quitGuard.request()
    await cut.quitGuard.request()
    expect(cut.asked.map(question => question.message)).toEqual(['2 agents are still working.', '2 agents are still saving notes.'])
    expect(service.stopNow).toHaveBeenCalledOnce()
    expect(cut.quit).toHaveBeenCalledOnce()

    const second = fakePause({ phase: 'saving', saving: 1, working: 0 })
    const resumed = guard(second.service, [0])
    await resumed.quitGuard.request()
    expect(resumed.show).toHaveBeenCalledOnce()
    second.move({ phase: 'running', saving: 0, working: 1 })
    await flush()
    expect(resumed.quit).not.toHaveBeenCalled()
    expect(second.service.listeners.size).toBe(0)
  })

  it('quits as before when the pause cannot be read', async () => {
    const service: DesktopPauseService = {
      snapshot: () => Promise.reject(new Error('host gone')),
      pause: () => Promise.reject(new Error('unused')),
      stopNow: () => Promise.reject(new Error('unused')),
      onChange: () => () => {},
    }
    const { quitGuard, quit, warn } = guard(service, [])
    await quitGuard.request()
    expect(quit).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('quit guard: pause unavailable, quitting: host gone')
  })

  it('asks in Chinese where the app runs in Chinese', async () => {
    const { service } = fakePause({ phase: 'running', saving: 0, working: 2 })
    const { quitGuard, asked } = guard(service, [2], 'zh')
    await quitGuard.request()
    expect(asked[0]).toMatchObject({ message: '2 个智能体仍在工作。', buttons: ['暂停并退出', '直接退出', '取消'] })
  })
})
