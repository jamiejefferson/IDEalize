/**
 * The wizard's owl: the per-step transparent WebM clip, served by the host
 * face at the URL ../owl-clip-urls.ts names (generated; the bytes stay out of
 * the client bundle). `data-owl-art` keys the element per step for future
 * retargeting. Under reduced motion the clip stays parked on its
 * first frame (no autoplay).
 */
import type { OnboardingStepId } from './steps.ts'
import { owlClipUrl } from '../owl-clip-urls.ts'
import css from './OwlArt.module.css'

/** Props for {@link OwlArt}. */
export interface OwlArtProps {
  /** The step the clip plays for. */
  step: OnboardingStepId
  /** True parks the clip on its first frame (reduced motion). */
  reduced: boolean
}

/** The per-step owl clip (decorative; the step copy carries the meaning). */
export function OwlArt({ step, reduced }: OwlArtProps) {
  return (
    <video
      className={css.owl}
      data-owl-art={step}
      src={owlClipUrl(step)}
      muted
      loop
      playsInline
      preload="auto"
      autoPlay={!reduced}
      aria-hidden="true"
    />
  )
}
