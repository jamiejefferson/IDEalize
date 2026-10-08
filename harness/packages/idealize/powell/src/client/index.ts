/**
 * @idealize/powell — browser half. In the desktop shell's floating window
 * (the `dsh-desktop-mode=askbar` marker the Askbar column used; Powell
 * replaced the column on 2 Oct 2026 and kept the window, so every guard
 * that keeps that page from minting chats still holds) the owl takes the
 * root slot and the page becomes Powell. Every other window gets nothing.
 * @module @idealize/powell/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PowellRoot, type PowellRootInjected } from './PowellRoot.tsx'
import { startStore } from './store.ts'
import { Mouth } from './voice.ts'

export { PowellRoot } from './PowellRoot.tsx'
export type { PowellRootInjected } from './PowellRoot.tsx'
export { Gestures, DOUBLE_MS, DRAG_PX, HOLD_MS } from './gestures.ts'
export type { GestureEffect, Timers } from './gestures.ts'
export { encodeWav, Mouth } from './voice.ts'
export { POSES } from './owl.ts'

/** Services the owl reads. */
export const inject = ['slots']

/**
 * Seat the owl in the floating window.
 * @param ctx - browser Cordis context.
 */
export function apply(ctx: ClientContext): void {
  if (new URLSearchParams(window.location.search).get('dsh-desktop-mode') !== 'askbar') return

  ctx.effect(() => {
    document.body.dataset.dshDesktopMode = 'powell'
    return () => { delete document.body.dataset.dshDesktopMode }
  }, 'idealize-powell: window marker')

  ctx.effect(() => {
    const mouth = new Mouth()
    const store = startStore(mouth)
    // Below the Askbar's -1: a single slot renders its lowest-priority registrant.
    const dispose = ctx.slots.register({
      name: 'root',
      priority: -2,
      inject: (): PowellRootInjected => ({ store, mouth }),
    }, PowellRoot)
    return () => {
      dispose()
      mouth.hush()
      store.stop()
    }
  }, 'idealize-powell: root surface')
}
