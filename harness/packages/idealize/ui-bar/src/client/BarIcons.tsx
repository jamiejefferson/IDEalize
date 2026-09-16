/**
 * The bar's own icon set: one 16x16 grid, 1.5px strokes, round caps, so the
 * row reads as a single family instead of borrowed upstream glyphs.
 */

import type React from 'react'

interface IconProps {
  size?: number
}

function frame(size: number | undefined, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size ?? 16}
      height={size ?? 16}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Folder: the files drawer. */
export function BarIconFiles({ size }: IconProps) {
  return frame(size, (
    <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h2.6c.46 0 .89.21 1.17.57l.71.9h5.02c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3.25c-.83 0-1.5-.67-1.5-1.5v-7.47Z" />
  ))
}

/** Terminal: a prompt chevron and an underscore in a rounded frame, the Terminal pane. */
export function BarIconTerminal({ size }: IconProps) {
  return frame(size, (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.75" />
      <path d="M4.75 6.25 7 8.25l-2.25 2" />
      <path d="M8.5 10.25h2.75" />
    </>
  ))
}

/**
 * Brain: the Brains pane (JJ, 11 Sep 2026, reversing the 3 Sep sparkle). A
 * two-lobed outline with the central fissure and one fold per lobe, drawn at
 * the same 1.3px stroke as the rail's other glyphs.
 */
export function BarIconModels({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M8 3.1a1.85 1.85 0 0 0-3.2-1.02 1.7 1.7 0 0 0-1.98 1.9A1.9 1.9 0 0 0 1.8 6.6a1.9 1.9 0 0 0 .6 2.9 1.85 1.85 0 0 0 1.5 2.35A1.8 1.8 0 0 0 8 12.9Z" />
      <path d="M8 3.1a1.85 1.85 0 0 1 3.2-1.02 1.7 1.7 0 0 1 1.98 1.9 1.9 1.9 0 0 1 1.02 2.62 1.9 1.9 0 0 1-.6 2.9 1.85 1.85 0 0 1-1.5 2.35A1.8 1.8 0 0 1 8 12.9Z" />
      <path d="M8 3.1v9.8" />
      <path d="M5.9 5.5c-.9.15-1.4.7-1.5 1.6M10.1 8.9c.9.15 1.4.7 1.5 1.6" />
    </>
  ))
}

/** Cog: the Settings pane (JJ, 11 Sep 2026). */
export function BarIconSettings({ size }: IconProps) {
  return frame(size, (
    <>
      <circle cx="8" cy="8" r="2.15" />
      <path d="M12.85 9.9a1.06 1.06 0 0 0 .21 1.17l.04.04a1.29 1.29 0 1 1-1.82 1.82l-.04-.04a1.06 1.06 0 0 0-1.17-.21 1.06 1.06 0 0 0-.64.97v.11a1.29 1.29 0 0 1-2.58 0v-.06a1.06 1.06 0 0 0-.69-.97 1.06 1.06 0 0 0-1.17.21l-.04.04a1.29 1.29 0 1 1-1.82-1.82l.04-.04a1.06 1.06 0 0 0 .21-1.17 1.06 1.06 0 0 0-.97-.64h-.11a1.29 1.29 0 0 1 0-2.58h.06a1.06 1.06 0 0 0 .97-.69 1.06 1.06 0 0 0-.21-1.17l-.04-.04a1.29 1.29 0 1 1 1.82-1.82l.04.04a1.06 1.06 0 0 0 1.17.21h.05a1.06 1.06 0 0 0 .64-.97v-.11a1.29 1.29 0 0 1 2.58 0v.06a1.06 1.06 0 0 0 .64.97 1.06 1.06 0 0 0 1.17-.21l.04-.04a1.29 1.29 0 1 1 1.82 1.82l-.04.04a1.06 1.06 0 0 0-.21 1.17v.05a1.06 1.06 0 0 0 .97.64h.11a1.29 1.29 0 0 1 0 2.58h-.06a1.06 1.06 0 0 0-.97.64Z" />
    </>
  ))
}

/** Door: the service hatch (JJ, 2026-08-28). */
export function BarIconHatch({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M4.25 13.4V4.15a1.5 1.5 0 0 1 1.5-1.5h4.5a1.5 1.5 0 0 1 1.5 1.5v9.25" />
      <path d="M2.6 13.4h10.8" />
      <circle cx="9.7" cy="8.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ))
}

/** Circular arrow: the files toolbar's refresh. */
export function BarIconRefresh({ size }: IconProps) {
  return frame(size, (
    <path d="M12.9 8.6A5 5 0 1 1 11.6 4.4M11.9 1.9l.2 2.7-2.7.2" />
  ))
}

/** Tray with an inbound arrow (V0's browse glyph): the browse-pane toggle. */
export function BarIconBrowse({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M2.25 9.75v2.5c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1v-2.5" />
      <path d="M2.25 9.75h3.25l.9 1.5h3.2l.9-1.5h3.25" />
      <path d="M8 2.75v4.5M6.25 5.5 8 7.25 9.75 5.5" />
    </>
  ))
}

/** Speech bubble with a heart: feedback. */
export function BarIconFeedback({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M8 2.25c3.45 0 6.25 2.35 6.25 5.25S11.45 12.75 8 12.75c-.6 0-1.18-.07-1.73-.2L3.4 13.9a.4.4 0 0 1-.55-.44l.42-2.32c-.95-.92-1.52-2.1-1.52-3.64 0-2.9 2.8-5.25 6.25-5.25Z" />
      <path d="M8 9.4 6.3 7.75a1.13 1.13 0 0 1 1.6-1.6l.1.1.1-.1a1.13 1.13 0 0 1 1.6 1.6L8 9.4Z" fill="currentColor" stroke="none" />
    </>
  ))
}


/** Big window shrinking to a pip: minimode. */
export function BarIconMinimode({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M13.25 6.5v-2.25c0-.83-.67-1.5-1.5-1.5H4.25c-.83 0-1.5.67-1.5 1.5v7.5c0 .83.67 1.5 1.5 1.5H6.5" />
      <rect x="8.75" y="8.75" width="5.5" height="4.5" rx="1.2" />
    </>
  ))
}

/** Puzzle piece: plugins (JJ, 2026-08-28). */
export function BarIconPlugins({ size }: IconProps) {
  return frame(size, (
    <path d="M3.7 2.5h8.6a1.2 1.2 0 0 1 1.2 1.2v2.8a1.5 1.5 0 1 1 0 3v2.8a1.2 1.2 0 0 1-1.2 1.2H9.5a1.5 1.5 0 1 0-3 0H3.7a1.2 1.2 0 0 1-1.2-1.2V3.7a1.2 1.2 0 0 1 1.2-1.2Z" />
  ))
}

/** Artist palette: the Appearance pane (JJ, 2026-08-28). */
export function BarIconAppearance({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M8 2.1c3.45 0 6.15 2.3 6.15 5.15 0 1.7-1.3 2.5-2.45 2.5h-1.2c-.9 0-1.6.7-1.6 1.6 0 .35.15.65.15 1.05 0 .85-.6 1.5-1.5 1.5-3.4 0-5.7-2.9-5.7-6.3S4.55 2.1 8 2.1Z" />
      <circle cx="5.4" cy="6.05" r=".85" fill="currentColor" stroke="none" />
      <circle cx="8.35" cy="4.85" r=".85" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6.4" r=".85" fill="currentColor" stroke="none" />
    </>
  ))
}

/** Chevron closing the drawer. */
export function BarIconClose({ size }: IconProps) {
  return frame(size, (
    <path d="m4.75 4.75 6.5 6.5m0-6.5-6.5 6.5" />
  ))
}

/** Document with a plus: create a file. */
export function BarIconFilePlus({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M9 1.75H4.75c-.55 0-1 .45-1 1v10.5c0 .55.45 1 1 1h6.5c.55 0 1-.45 1-1V5L9 1.75Z" />
      <path d="M9 1.75V5h3.25" />
      <path d="M8 7.75v3.5M6.25 9.5h3.5" />
    </>
  ))
}

/** Folder with a plus: create a folder. */
export function BarIconFolderPlus({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h2.6c.46 0 .89.21 1.17.57l.71.9h5.02c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3.25c-.83 0-1.5-.67-1.5-1.5v-7.47Z" />
      <path d="M8 6.75v3.5M6.25 8.5h3.5" />
    </>
  ))
}

/** Indented list: the file viewer's section-title outline. */
export function BarIconOutline({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M2.75 4.25h10.5" />
      <path d="M5.75 8h7.5" />
      <path d="M5.75 11.75h7.5" />
    </>
  ))
}

/** Arrow right: what a tile or a brain row does when it is pressed. */
export function BarIconArrowRight({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M3 8h10" />
      <path d="m9 4.25 3.75 3.75L9 11.75" />
    </>
  ))
}

/** Chevron left: the way back to the previous step. */
export function BarIconChevronLeft({ size }: IconProps) {
  return frame(size, (
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  ))
}

/** Plus: add a brain. */
export function BarIconPlus({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M8 3.25v9.5" />
      <path d="M3.25 8h9.5" />
    </>
  ))
}

/** Key: the provider key a refused space is waiting on. */
export function BarIconKey({ size }: IconProps) {
  return frame(size, (
    <>
      <circle cx="5" cy="8" r="2.75" />
      <path d="M7.75 8h6" />
      <path d="M11.25 8v2.25" />
    </>
  ))
}

/** Offset bars: the trajectory ledger's timing overview. */
export function BarIconTrajectory({ size }: IconProps) {
  return frame(size, (
    <>
      <path d="M2.25 4h7" />
      <path d="M4.75 8h9" />
      <path d="M2.25 12h5.5" />
    </>
  ))
}

/** Calendar: the schedule pane's week. */
export function BarIconSchedule({ size }: IconProps) {
  return frame(size, (
    <>
      <rect x="1.75" y="3.25" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6.75h12.5" />
      <path d="M5.25 1.75v3M10.75 1.75v3" />
    </>
  ))
}
