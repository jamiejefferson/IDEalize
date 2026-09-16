/**
 * The first-use speech notice: whether this person has been told what a hold
 * captures and where it is processed.
 *
 * Kept in this window's storage rather than in settings because it records a
 * notice being read, not a preference the agent or another surface acts on.
 * Cleared storage shows the notice again, which is the safe direction.
 * @module @idealize/askbar/src/client/speech-notice
 */

/** Storage key holding the acknowledgement. */
export const SPEECH_NOTICE_KEY = 'idealize.askbar.speechNotice'

/**
 * Whether the notice has been read.
 * @returns true once it has been acknowledged in this window's storage.
 */
export function speechNoticeSeen(): boolean {
  try {
    return localStorage.getItem(SPEECH_NOTICE_KEY) === '1'
  } catch {
    // Storage can be unavailable (a private context, or storage turned off);
    // showing the notice again is the safe answer.
    return false
  }
}

/** Record that the notice has been read. */
export function rememberSpeechNotice(): void {
  try {
    localStorage.setItem(SPEECH_NOTICE_KEY, '1')
  } catch {
    // As above: failing to remember only means the notice is shown again.
  }
}
