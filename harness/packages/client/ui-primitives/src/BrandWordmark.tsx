// IDEalize brand wordmark: the "IDE" monogram beside the product name in
// the brand's DM Mono treatment (the same lockup as the boot splash). The
// component keeps its upstream name (DeepSeek's wordmark) so its consumer —
// the expanded sidebar's brand row — needs no changes and upstream merges
// stay small. Ink rides currentColor.

import type { CSSProperties } from 'react'
import clsx from 'clsx'
import type { IconProps } from './icons/props.ts'
import { FishLogo } from './FishLogo.tsx'
import css from './BrandWordmark.module.css'

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; the row scales from it).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark row (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={clsx(css.root, className)}
      style={{ '--brand-size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <FishLogo className={css.mark} size={Math.round(size * 0.92)} />
      <span className={css.name}>IDEalize</span>
    </span>
  )
}
