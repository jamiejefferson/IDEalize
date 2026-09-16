/**
 * The shell.overlay occupant: the centred brand card on an opaque full-frame
 * layer. It renders from the frame's first commit, so it is already in place
 * when the boot splash fades, and it stays parked (visible) while another
 * overlay occupant is on screen. Once the machine arms, the layer fades out
 * over 350ms with pointer events off; 'done' renders nothing. All sequencing
 * decisions live in the launch machine — this component is a pure function of
 * the phase.
 */
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { LaunchPhase } from './launch-machine.ts'
import { LAUNCH_LAYER_ATTRIBUTE } from './launch-machine.ts'
import { LAUNCH_MARK_URI } from './launch-mark.ts'
import css from './LaunchOverlay.module.css'

/** Registration-side face: the machine's phase store, bound as `useLaunch`. */
export interface LaunchInjected {
  hooks: {
    /** The park/play machine's phase. */
    launch: SnapshotStore<LaunchPhase>
  }
}

export type LaunchOverlayProps = PropsRuntime<'shell.overlay'>
  & InjectFace<LaunchInjected>

export function LaunchOverlay({ useLaunch }: LaunchOverlayProps) {
  const phase = useLaunch(value => value)
  if (phase === 'done') return null
  return (
    <div
      {...{ [LAUNCH_LAYER_ATTRIBUTE]: '' }}
      className={phase === 'playing' ? css.leaving : css.layer}
      aria-hidden="true"
    >
      <img src={LAUNCH_MARK_URI} alt="" className={css.mark} draggable={false} />
    </div>
  )
}
