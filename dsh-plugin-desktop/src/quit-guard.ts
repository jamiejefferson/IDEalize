/**
 * Quitting while agents work asks whether to pause them first (feedback
 * 495cec0a; JJ, 30 Oct 2026). Quitting ends every agent's run, so work in
 * flight is lost unless the agent wrote where it got to. The harness owns the
 * pause (`@idealize/comm`'s `ctx.idealizePause`): Pause tells each working
 * agent to save its notes and stop, and Resume picks the work up after the
 * next launch. This guard sits on every quit the person asks for (Cmd-Q, the
 * app menu, the Dock and the tray) and asks before the Host tree is disposed.
 *
 * - Nobody working, or every agent already paused: quit at once.
 * - Agents working: Pause and Quit, Quit Anyway or Cancel. Pause and Quit
 *   shows the window, so the sidebar's count of agents saving notes is on
 *   screen, and quits once the pause completes.
 * - Agents saving notes (the person pressed Pause, or chose Pause and Quit
 *   and quit again): Quit When Paused, Stop Now and Quit, or Cancel.
 *
 * Signals, restarts and the update installer's exit are not guarded: they are
 * not the person quitting. Any failure reading the pause quits as before.
 */

import type { DesktopLocale } from './runtime.ts'

/** Where every agent stands (restated from `@idealize/comm`'s pause snapshot). */
export interface DesktopPauseSnapshot {
  phase: 'running' | 'saving' | 'paused'
  /** Agents still writing their notes. */
  saving: number
  /** Agents working right now, counted while running. */
  working: number
}

/** The harness pause service as this guard uses it. */
export interface DesktopPauseService {
  snapshot(): Promise<DesktopPauseSnapshot>
  pause(): Promise<DesktopPauseSnapshot>
  stopNow(): Promise<DesktopPauseSnapshot>
  onChange(listener: () => void): () => void
}

/** One native question: a title line, its detail and the buttons in order. */
export interface DesktopQuitQuestion {
  message: string
  detail: string
  buttons: readonly string[]
  /** Index of the button Return presses. */
  defaultId: number
  /** Index of the button Escape presses. */
  cancelId: number
}

/** What the guard needs from the app. */
export interface DesktopQuitGuardOptions {
  /** The harness pause service, or undefined before the Host is up. */
  pause: () => DesktopPauseService | undefined
  /** Ask a native question; resolves with the index of the button pressed. */
  ask: (question: DesktopQuitQuestion) => Promise<number>
  /** Bring the main window forward. */
  show: () => void
  /** Run the ordinary quit: dispose the Host tree, then exit. */
  quit: () => void
  /** The app's locale for the dialog copy. */
  locale: () => DesktopLocale
  /** Log a failure that made the guard fall back to quitting. */
  warn: (message: string) => void
}

/** The guarded quit. */
export interface DesktopQuitGuard {
  /** Handle one quit the person asked for. */
  request(): Promise<void>
}

/** Button order of the question asked while agents work. */
const WorkingAnswer = { PauseAndQuit: 0, QuitAnyway: 1, Cancel: 2 } as const

/** Button order of the question asked while agents save their notes. */
const SavingAnswer = { QuitWhenPaused: 0, StopNowAndQuit: 1, Cancel: 2 } as const

const copy = {
  en: {
    working: (count: number) => count === 1 ? '1 agent is still working.' : `${String(count)} agents are still working.`,
    workingDetail: 'Pausing first lets each agent write where it got to into the project\'s notes, so Resume can pick the work up when you next open IDEalize.',
    workingButtons: ['Pause and Quit', 'Quit Anyway', 'Cancel'],
    saving: (count: number) => count === 1 ? '1 agent is still saving notes.' : `${String(count)} agents are still saving notes.`,
    savingDetail: 'IDEalize quits once every agent has saved its notes. Stop Now and Quit interrupts them, so their notes may be unfinished.',
    savingButtons: ['Quit When Paused', 'Stop Now and Quit', 'Cancel'],
  },
  zh: {
    working: (count: number) => `${String(count)} 个智能体仍在工作。`,
    workingDetail: '先暂停，每个智能体会把进度写入项目笔记，下次打开 IDEalize 后可以点“继续”接着做。',
    workingButtons: ['暂停并退出', '直接退出', '取消'],
    saving: (count: number) => `${String(count)} 个智能体仍在保存笔记。`,
    savingDetail: '所有智能体保存完笔记后 IDEalize 将退出。“立即停止并退出”会打断它们，笔记可能不完整。',
    savingButtons: ['暂停后退出', '立即停止并退出', '取消'],
  },
} as const

/**
 * Create the guard around the ordinary quit.
 * @param options - the pause service, the native question and the quit.
 * @returns the guarded quit.
 */
export function createDesktopQuitGuard(options: DesktopQuitGuardOptions): DesktopQuitGuard {
  let asking = false
  let quitting = false
  let waiting: (() => void) | undefined

  const stopWaiting = (): void => {
    waiting?.()
    waiting = undefined
  }

  const quit = (): void => {
    quitting = true
    stopWaiting()
    options.quit()
  }

  /**
   * Quit once the pause reaches paused; the first check catches a change that
   * landed before the listener. Resume pressed meanwhile means the person
   * changed their mind, so the quit is dropped.
   */
  const quitWhenPaused = (service: DesktopPauseService): void => {
    if (waiting !== undefined) return
    const check = (): void => {
      void service.snapshot().then((snapshot) => {
        if (waiting === undefined) return
        if (snapshot.phase === 'paused') quit()
        else if (snapshot.phase === 'running') stopWaiting()
      }, (cause: unknown) => {
        options.warn(`quit guard: pause unreadable while waiting, quitting: ${String(cause)}`)
        quit()
      })
    }
    waiting = service.onChange(check)
    check()
  }

  const decide = async (): Promise<void> => {
    const service = options.pause()
    if (service === undefined) {
      quit()
      return
    }
    const snapshot = await service.snapshot()
    if (snapshot.phase === 'paused' || (snapshot.phase === 'running' && snapshot.working === 0)) {
      quit()
      return
    }
    const words = copy[options.locale()]
    if (snapshot.phase === 'running') {
      const answer = await options.ask({
        message: words.working(snapshot.working),
        detail: words.workingDetail,
        buttons: words.workingButtons,
        defaultId: WorkingAnswer.PauseAndQuit,
        cancelId: WorkingAnswer.Cancel,
      })
      if (answer === WorkingAnswer.QuitAnyway) quit()
      if (answer !== WorkingAnswer.PauseAndQuit) return
      options.show()
      const paused = await service.pause()
      if (paused.phase === 'saving') quitWhenPaused(service)
      else quit()
      return
    }
    const answer = await options.ask({
      message: words.saving(snapshot.saving),
      detail: words.savingDetail,
      buttons: words.savingButtons,
      defaultId: SavingAnswer.QuitWhenPaused,
      cancelId: SavingAnswer.Cancel,
    })
    if (answer === SavingAnswer.Cancel) {
      stopWaiting()
      return
    }
    if (answer === SavingAnswer.StopNowAndQuit) {
      await service.stopNow()
      quit()
      return
    }
    options.show()
    quitWhenPaused(service)
  }

  return {
    async request() {
      // Once the guard has let the quit through, a further quit escalates as before.
      if (quitting) {
        options.quit()
        return
      }
      if (asking) return
      asking = true
      try {
        await decide()
      } catch (cause) {
        options.warn(`quit guard: pause unavailable, quitting: ${cause instanceof Error ? cause.message : String(cause)}`)
        quit()
      } finally {
        asking = false
      }
    },
  }
}
