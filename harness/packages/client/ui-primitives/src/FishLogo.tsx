// IDEalize "IDE" monogram — the caps row of V0's brand lockup
// (website/assets/idealize-mark), exact paths. The component keeps its
// upstream name (DeepSeek's fish mark) so the two consumers — the sidebar
// rail and the hero headline — need no changes and upstream merges stay
// small. Native 25.4x19.4; color rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the brand mark.
 * @param props.size - width in px (default 24; height keeps the 25.4:19.4 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 19.4) / 25.4}
      className={className}
      viewBox="16 14.2 25.4 19.4"
      fill="none"
      aria-hidden="true"
    >
      <path d="M16.3838 33.2188V14.5888H20.5008V33.2188H16.3838Z" fill="currentColor" />
      <path d="M21.2087 33.2188V14.5888H25.9237C27.5491 14.5888 28.8141 14.7958 29.7187 15.2098C30.6234 15.6084 31.2597 16.2448 31.6277 17.1188C31.9957 17.9774 32.1797 19.0968 32.1797 20.4768V27.2388C32.1797 28.6341 31.9957 29.7764 31.6277 30.6658C31.2597 31.5398 30.6234 32.1838 29.7187 32.5978C28.8294 33.0118 27.5797 33.2188 25.9697 33.2188H21.2087ZM25.3257 30.3668H25.9697C26.5984 30.3668 27.0507 30.2748 27.3267 30.0908C27.6027 29.9068 27.7714 29.6308 27.8327 29.2628C27.9094 28.8948 27.9477 28.4348 27.9477 27.8828V19.7638C27.9477 19.2118 27.9017 18.7671 27.8097 18.4298C27.7331 18.0924 27.5567 17.8471 27.2807 17.6938C27.0047 17.5404 26.5601 17.4638 25.9467 17.4638H25.3257V30.3668Z" fill="currentColor" />
      <path d="M32.6153 33.2188V14.5888H40.9873V17.3948H36.7323V22.0178L36.7381 21.9542V24.8062L36.7323 24.8698V30.4358H41.0333V33.2188H32.6153Z" fill="currentColor" />
      <rect x="37.8161" y="22.0069" width="3.21722" height="2.86557" fill="currentColor" />
    </svg>
  )
}
