/**
 * The browser half's output devices: the chime (an Audio element over the
 * host-served asset, volume from settings) and the notification (the desktop
 * shell's native notifier through the host route when present, the Web
 * Notifications API otherwise). Both fail silently: a missed chime is never
 * worth an error.
 */

/** The host-served chime asset. */
export const CHIME_URL = '/idealize/notify/chime.mp3'

/**
 * Play the chime. Resolves when playback starts or fails; never rejects.
 * @param volume - playback volume, clamped to 0…1.
 */
export async function playChime(volume: number): Promise<void> {
  if (typeof Audio === 'undefined') return
  try {
    const audio = new Audio(CHIME_URL)
    audio.volume = Math.min(1, Math.max(0, volume))
    await audio.play()
  } catch {
    // autoplay refused before any user gesture, or the asset is unreachable
  }
}

/**
 * Raise one notification: native through the desktop shell when the host
 * offers it, else a Web Notification once permission is granted.
 * @param title - the notification title.
 * @param body - the notification body.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    const native = await fetch('/idealize/notify/native', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body }),
    })
    if (native.ok) return
  } catch {
    // host unreachable: fall through to the browser's own notifications
  }
  if (typeof Notification === 'undefined') return
  try {
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission === 'granted') new Notification(title, { body, silent: true })
  } catch {
    // permission prompt refused outside a user gesture; the chime already played
  }
}

/** What the person can do with one alert; the caller records both. */
export interface AlertHandlers {
  /** The alert was clicked: bring the window forward and open the event. */
  open: () => void
  /** The alert was closed without being opened. */
  dismiss: () => void
}

/**
 * Raise one alert the person can answer. The browser's own notification is
 * preferred over the desktop route because it is the half that reports a
 * click back: in the packaged app it is a native macOS notification either
 * way. Without permission the desktop route still raises it, and the alert
 * then carries no way back to the event.
 * @param title - the alert title.
 * @param body - the alert body.
 * @param handlers - what to run when the person opens or dismisses it.
 */
export async function notifyAttention(title: string, body: string, handlers: AlertHandlers): Promise<void> {
  if (typeof Notification !== 'undefined') {
    try {
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission === 'granted') {
        const raised = new Notification(title, { body, silent: true })
        let opened = false
        raised.onclick = () => {
          opened = true
          window.focus()
          handlers.open()
        }
        // A click closes the notification too, so the dismissal only counts
        // when the person let it go without opening it.
        raised.onclose = () => { if (!opened) handlers.dismiss() }
        return
      }
    } catch {
      // permission refused outside a user gesture: fall through to the host
    }
  }
  await notify(title, body)
}

/** Ask for Web Notification permission from a user gesture (the Preview button). */
export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  void Notification.requestPermission().catch(() => {})
}
