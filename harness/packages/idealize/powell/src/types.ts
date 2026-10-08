/**
 * Wire types shared by Powell's host routes and the owl window. Free of
 * cordis imports so the browser bundle can read them.
 * @module @idealize/powell/types
 */

/** What Powell is doing, as the owl shows it. */
export type PowellMood = 'idle' | 'listening' | 'thinking' | 'acting' | 'waiting' | 'done' | 'problem'

/** One button in a speech bubble. */
export interface PowellChoice {
  /** The label on the button. */
  label: string
  /** What pressing it does: send the label as the next message, answer an approval, or open a destination. */
  action: 'say' | 'allow' | 'deny' | 'open' | 'retry'
  /** For `open`: the path or URL. For `allow`/`deny`: the approval id. */
  target?: string
  /** True for the one dark (primary) button; every other button is grey. */
  primary?: boolean
}

/** Powell's words on screen. */
export interface PowellBubble {
  /** The line Powell says. */
  text: string
  /** At most two buttons (JJ, 2 Oct 2026: one dark, one grey). */
  choices: PowellChoice[]
  /** Why the bubble is up; a `reply` fades on its own, the others wait. */
  kind: 'reply' | 'question' | 'approval' | 'problem' | 'consent'
}

/** The active project, as the tag under Powell names it. */
export interface PowellProject {
  /** Short display name (the folder's basename). */
  name: string
  /** Absolute folder: the working folder, or the notes folder when the project has no other. */
  path: string
  /** The project's notes folder in the documentation vault, when it has one. */
  notes?: string
}

/** Everything the owl renders. */
export interface PowellView {
  mood: PowellMood
  /** The dark tag under Powell while busy ("Working in Paper"); empty shows the project. */
  status: string
  project: PowellProject | null
  bubble: PowellBubble | null
  /** True while a turn runs, so Stop shows. */
  busy: boolean
  /** The person agreed that their voice goes to a cloud service for transcription. */
  voiceConsent: boolean
  /** Powell shows replies without reading them aloud. */
  muted: boolean
}

/** One event on the owl's stream. */
export type PowellStreamEvent =
  | { type: 'view'; view: PowellView }
  /** Speak this sentence now; `clip` names a cached acknowledgement when one matches. */
  | { type: 'say'; id: string; text: string; clip?: string }
  /** Stop talking (the user interrupted, or a new turn started). */
  | { type: 'hush' }

/** One cached acknowledgement in the voice manifest. */
export interface PowellClip {
  /** Stable key, e.g. `on-it`. */
  id: string
  /** The words in the clip. */
  text: string
  /** Route serving the audio. */
  url: string
}

/** The voice manifest the owl preloads. */
export interface PowellVoiceManifest {
  voice: string
  model: string
  clips: PowellClip[]
}
