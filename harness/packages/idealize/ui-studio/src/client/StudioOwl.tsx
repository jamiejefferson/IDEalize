/**
 * The owl on the empty Studio (JJ, 8 Sep 2026: "I'd like the owl to live
 * here, rather than the placeholder copy"): V0's run cycle from the boot
 * splash, rendered by the shared `OwlMark`, which plays the cycle once on
 * appear and again on hover and holds the resting frame under
 * `prefers-reduced-motion`.
 * @module @idealize/ui-studio/client/StudioOwl
 */

import { OwlMark } from '@deepseek-ai/dsh-client-ui-primitives'

/** The owl's rendered height in CSS pixels; width follows the frames' 190:210 ratio. */
export const STUDIO_OWL_HEIGHT = 120

/**
 * Render the owl, centred by its own wrapper.
 * @param props - an optional class for placement.
 * @returns the wrapper span carrying the animated owl.
 */
export function StudioOwl({ className }: { className?: string | undefined }) {
  return (
    <span className={className} data-studio-owl="">
      <OwlMark size={STUDIO_OWL_HEIGHT} animate />
    </span>
  )
}
