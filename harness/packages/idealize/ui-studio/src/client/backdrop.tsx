/**
 * The Studio's backdrop (appearance `studio-backdrop.ts`): the resolved paint
 * the appearance panel's Studio tab sets, held here for the view, and the
 * layers that draw it. The plugin body pushes each new paint through
 * {@link applyStudioBackdrop}; without the appearance service the paint stays
 * undefined and the Studio sits on the app theme.
 * @module @idealize/ui-studio/client/backdrop
 */

import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { StudioBackdropPaint } from '@idealize/appearance/client'
import css from './StudioView.module.css'

const store = createSnapshotStore<{ paint: StudioBackdropPaint | undefined }>({ paint: undefined })

/** The custom properties last published on the page root. */
let published: string[] = []

/** Set on the page root while a backdrop is drawn, so a view outside this package can style itself for it. */
export const BACKDROP_ATTRIBUTE = 'data-idealize-backdrop'

/**
 * Take the backdrop to draw. Its text and panel values go on the page root as
 * custom properties, with {@link BACKDROP_ATTRIBUTE} beside them, because the
 * composer card sits outside the view and the media Studio chat
 * (`@idealize/ui-gallery`) draws the same backdrop from its own package.
 * @param next - the resolved paint, or undefined to return to the app theme.
 */
export function applyStudioBackdrop(next: StudioBackdropPaint | undefined): void {
  if (JSON.stringify(next) === JSON.stringify(store.getSnapshot().paint)) return
  const style = document.documentElement.style
  for (const name of published) style.removeProperty(name)
  published = next === undefined ? [] : Object.keys(next.variables)
  if (next !== undefined) for (const [name, value] of Object.entries(next.variables)) style.setProperty(name, value)
  document.documentElement.toggleAttribute(BACKDROP_ATTRIBUTE, next !== undefined)
  store.update((draft) => { draft.paint = next })
}

/**
 * The backdrop the Studio view draws on.
 * @returns the current paint, or undefined on the app theme.
 */
export function useStudioBackdrop(): StudioBackdropPaint | undefined {
  return useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot().paint)
}

/**
 * The backdrop's layers, behind the Studio's content: the lamp's pool, the
 * shade and the floor, the corner falloff, then the canvas clouding and the
 * grain over all of it. The stack carries the wall colour itself: it is its
 * own stacking context, and the clouding and grain blend with what is inside it.
 * @param props - the resolved paint.
 * @returns the layer stack.
 */
export function StudioBackdrop({ paint }: { paint: StudioBackdropPaint }) {
  const floor = paint.floor
  return (
    <div className={css.backdrop} aria-hidden="true" data-testid="idealize-studio-backdrop" style={{ backgroundColor: paint.wall }}>
      <div className={css.backdropLayer} data-layer="light" style={{ backgroundImage: paint.light }} />
      {floor !== undefined && <div className={css.backdropLayer} data-layer="seam" style={{ backgroundImage: floor.seam }} />}
      {floor !== undefined && (
        <div
          className={css.backdropLayer}
          data-layer="floor"
          style={{
            top: floor.top, backgroundColor: floor.colour, backgroundImage: floor.image, maskImage: floor.mask, WebkitMaskImage: floor.mask,
          }}
        >
          {floor.streaks !== undefined && <div className={css.backdropStreaks} data-layer="streaks" style={{ opacity: floor.streaks }} />}
        </div>
      )}
      <div className={css.backdropLayer} data-layer="vignette" style={{ backgroundImage: paint.vignette }} />
      {paint.mottle !== undefined && (
        <div className={css.backdropMottle} data-layer="mottle" style={{ opacity: paint.mottle.opacity, backgroundSize: `${paint.mottle.size}px ${paint.mottle.size}px` }} />
      )}
      {paint.grain !== undefined && (
        <div className={css.backdropGrain} data-layer="grain" style={{ opacity: paint.grain.opacity, backgroundSize: `${paint.grain.size}px ${paint.grain.size}px` }} />
      )}
    </div>
  )
}

/**
 * The current backdrop's layers, or nothing on the app theme. This is the
 * `studioBackdrop` service's component: a view in another package seats it
 * behind its own content and needs no paint of its own.
 * @returns the layer stack, or null.
 */
export function StudioBackdropLayers() {
  const paint = useStudioBackdrop()
  return paint === undefined ? null : <StudioBackdrop paint={paint} />
}
