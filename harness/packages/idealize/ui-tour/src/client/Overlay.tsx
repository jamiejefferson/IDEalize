/**
 * The shell.overlay occupant: renders the tour run or the shortcuts sheet
 * from the view store, nothing while both are idle.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { Keybind } from './keybinds.ts'
import type { TourTarget } from './tour-script.ts'
import type { TourViewState } from './tour-store.ts'
import { TourOverlay } from './TourOverlay.tsx'
import { KeybindsSheet } from './KeybindsSheet.tsx'

/** Registration-side face. */
export interface OverlayInjected {
  hooks: {
    /** The run / sheet state. */
    view: SnapshotStore<TourViewState>
    /** Live grouped catalogue for the sheet. */
    keybinds: SnapshotStore<{ group: string; items: Keybind[] }[]>
  }
  /** Resolve a tour target to its element. */
  resolve: (target: TourTarget) => Element | null
  /** Advance the run (the last step ends it and persists the seed). */
  next: () => void
  /** Step back. */
  back: () => void
  /** End the run and persist the seed. */
  finish: () => void
  /** Close the sheet. */
  closeSheet: () => void
}

export type OverlayProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'idealize-tour'>
  & InjectFace<OverlayInjected>

export function Overlay({ useView, useKeybinds, resolve, next, back, finish, closeSheet, t }: OverlayProps) {
  const steps = useView(state => state.steps)
  const index = useView(state => state.index)
  const sheet = useView(state => state.sheet)
  const groups = useKeybinds(value => value)

  if (steps !== null) {
    return (
      <TourOverlay
        steps={steps}
        index={index}
        resolve={resolve}
        onNext={next}
        onBack={back}
        onFinish={finish}
        t={t}
      />
    )
  }
  if (sheet) return <KeybindsSheet groups={groups} onClose={closeSheet} t={t} />
  return null
}
