/**
 * IDEalize opening sequence, browser half. Two parts share one park/play
 * machine (launch-machine.ts): the shell.overlay occupant `idealize-launch`
 * (order 10 — below the tour's 90 and first-run onboarding's 95, so those
 * paint above the logo layer) renders the centred brand card bridging the
 * boot splash, and one injected global stylesheet keyframes the existing
 * `data-idealize-surface` hooks (sessions slides from the left, chat from the
 * right; the rail animates itself in ui-bar). The machine arms the beats by
 * setting `data-idealize-launch="playing"` on the body exactly once per
 * launch: it stays parked while any other shell.overlay occupant is actively
 * rendering and plays when the last one clears. prefers-reduced-motion skips
 * every beat.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-layout SlotMap merge (shell.overlay).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createLaunchMachine } from './launch-machine.ts'
import { LAUNCH_SHEET_CSS, LAUNCH_SHEET_ID } from './launch-sheet.ts'
import { LaunchOverlay, type LaunchInjected } from './LaunchOverlay.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Client plugin body: the panel-beat sheet, the park/play machine, and the
 * logo-layer occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The panel beats ride one global sheet over the surface hooks: the
  // columns' module class names are hashed, so a scoped stylesheet cannot
  // reach them (the appearance package's sheet sets the precedent).
  ctx.effect(() => {
    const sheet = document.createElement('style')
    sheet.id = LAUNCH_SHEET_ID
    sheet.textContent = LAUNCH_SHEET_CSS
    document.head.append(sheet)
    return () => { sheet.remove() }
  }, 'idealize-launch: panel sheet')

  const machine = createLaunchMachine()
  ctx.effect(() => {
    machine.start()
    return () => { machine.dispose() }
  }, 'idealize-launch: park/play machine')

  const injected = (): LaunchInjected => ({ hooks: { launch: machine.phases } })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'idealize-launch',
    order: 10,
    inject: injected,
  }, LaunchOverlay))
}
