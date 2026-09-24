/**
 * @idealize/notify, browser half.
 *
 * - The announcement banner on the frame's `shell.banner` strip: the newest
 *   active row from `/idealize/announcements`, gated by the app version
 *   (`/idealize/notify/app`) and the dismissed id persisted in the
 *   `idealize-notify` settings section (V0's `AnnouncementStore`).
 * - The done chime: the host bridge's SSE feed is seeded with the newest
 *   retained sequence before it is read live, so work that finished before
 *   this page attached (app restore, tab reload) never chimes; each fresh
 *   `agent-finished` plays the chime at the settings volume and raises a
 *   notification (native through the host when the desktop shell offers it,
 *   Web Notifications otherwise).
 * - The chime row in General settings: on/off, the sound (the built-in
 *   chime or one of the operating system's own alert sounds, listed by
 *   `/idealize/notify/sounds`), volume slider, preview.
 * - The Studio's alerts: an `attention` frame on the same feed raises one
 *   notification the person can answer — clicking it opens that Studio event
 *   and records `opened`, letting it go records `dismissed`. The Askbar
 *   window skips them, so one event alerts once.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ui-layout SlotMap merge (the shell.banner seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the ctx.settingsScope Context merge and the settings slots.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { selectAnnouncement, type Announcement } from '../announcement.ts'
import { createChimeGate, type GateEvent } from '../chime-gate.ts'
import { BUILT_IN_CHIME, BUILT_IN_CHIME_SOUND, CHIME_SOUNDS_PATH, type ChimeSound, decodeChimeSounds } from '../chime-sounds.ts'
import { NOTIFY_SETTINGS_NAMESPACE, type NotifySettings } from '../settings.ts'
import { AnnouncementBanner, type AnnouncementBannerInjected } from './AnnouncementBanner.tsx'
import { ChimeRow, type ChimePreference, type ChimeRowInjected } from './ChimeRow.tsx'
import { type BridgeFeedAttachment, followBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'
import { requestStudio } from '@idealize/askbar/src/client/studio-request.ts'
import { notify, notifyAttention, playChime, requestNotificationPermission } from './notifier.ts'
import { en, zh, type NotifyKey } from './locales.ts'

export { AnnouncementBanner } from './AnnouncementBanner.tsx'
export { ChimeRow } from './ChimeRow.tsx'
export type { NotifyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The announcement banner's and chime row's copy. */
    'idealize-notify': NotifyKey
  }
}

/**
 * The output-device service other plugins reach (`ctx.idealizeNotify`):
 * raise a notification or the done chime without importing this plugin's
 * components (the client bundle purity gate forbids cross-plugin value
 * imports — services are the sanctioned channel).
 */
export interface IdealizeNotify {
  /** Raise one notification (native through the desktop shell when present, Web Notifications otherwise). */
  notify(title: string, body: string): void
  /** Play the done chime at the user's settings volume; silent when the chime preference is off. */
  chime(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The notify plugin's output devices (this plugin owns the concrete value). */
    idealizeNotify: IdealizeNotify
  }
}

/** One bridge feed frame this plugin reads: the chime's gate fields plus an alert's. */
interface FeedEvent extends GateEvent {
  title: string
  body: string
  /** Present on `attention` frames: the Studio event the alert names. */
  studioEvent?: string
  /** On `agent-finished`: the turn ended in an error, so no reply is waiting. */
  failed?: boolean
}

/**
 * Record what the person did with one alert. The host owns the record; a
 * failed report leaves it `sent`, which is honest — the alert did go out.
 * @param studioEvent - the Studio event the alert named.
 * @param state - `opened` or `dismissed`.
 */
async function recordAlertState(studioEvent: string, state: 'opened' | 'dismissed'): Promise<void> {
  try {
    await fetch('/idealize/notify/attention/state', {
      method: 'POST',
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ event: studioEvent, state }),
    })
  } catch {
    // the host went away between the alert and the answer
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-notify'

/** Schema defaults, mirrored for the moment before the settings scope loads. */
const DEFAULTS: NotifySettings = { chimeEnabled: true, chimeVolume: 0.4, chimeSound: BUILT_IN_CHIME_SOUND, lastSeenAnnouncementId: '' }

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The Askbar window runs the same bundle; one alert per event, raised where
  // the Studio can be opened.
  const alertsHere = new URLSearchParams(window.location.search).get('dsh-desktop-mode') !== 'askbar'
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-notify: dictionaries')
  const t = ctx.locale.bind(NS)

  const scope = ctx.settingsScope.bind<NotifySettings>({ namespace: NOTIFY_SETTINGS_NAMESPACE })
  const current = (): NotifySettings => ({ ...DEFAULTS, ...scope.getSnapshot().value })

  // ── Announcement banner ────────────────────────────────────────────────
  const announcement = createSnapshotStore<Announcement | undefined>(undefined)
  let rows: unknown
  let appVersion: string | undefined
  let fetched = false
  const reconsider = (): void => {
    if (!fetched || scope.getSnapshot().status === 'loading') return
    const next = selectAnnouncement(rows, appVersion, current().lastSeenAnnouncementId)
    if (next?.id !== announcement.getSnapshot()?.id) announcement.set(next)
  }
  scope.subscribe(reconsider)
  const fetchAnnouncement = async (): Promise<void> => {
    try {
      const [appRes, rowsRes] = await Promise.all([
        fetch('/idealize/notify/app'),
        fetch('/idealize/announcements'),
      ])
      if (appRes.ok) appVersion = ((await appRes.json()) as { appVersion?: string }).appVersion
      if (rowsRes.ok) rows = await rowsRes.json()
    } catch {
      // offline or the route is absent: no banner, never an error (V0's rule)
    }
    fetched = true
    reconsider()
  }
  void fetchAnnouncement()

  ctx.slots.inject('shell.banner', () => ctx.slots.register({
    name: 'shell.banner',
    id: 'idealize-announcement',
    order: 10,
    locale: NS,
    inject: (): AnnouncementBannerInjected => ({
      hooks: { announcement },
      dismiss: () => {
        const shown = announcement.getSnapshot()
        if (shown === undefined) return
        announcement.set(undefined)
        void scope.set('lastSeenAnnouncementId', shown.id)
      },
      openLink: (url) => { window.open(url, '_blank', 'noopener,noreferrer') },
    }),
  }, AnnouncementBanner))

  // ── Chime preference ───────────────────────────────────────────────────
  const chime = createSnapshotStore<ChimePreference>({
    enabled: DEFAULTS.chimeEnabled, volume: DEFAULTS.chimeVolume, sound: DEFAULTS.chimeSound,
  })
  const adoptChime = (): void => {
    const settings = current()
    const snapshot = chime.getSnapshot()
    const next: ChimePreference = { enabled: settings.chimeEnabled, volume: settings.chimeVolume, sound: settings.chimeSound }
    if (snapshot.enabled !== next.enabled || snapshot.volume !== next.volume || snapshot.sound !== next.sound) chime.set(next)
  }
  scope.subscribe(adoptChime)
  adoptChime()
  /** The chosen sound at the chosen volume, when the chime is on. */
  const playChosen = (): void => {
    const preference = chime.getSnapshot()
    if (preference.enabled) void playChime(preference.volume, preference.sound)
  }

  // The catalogue: the built-in chime alone until the host answers, and
  // still that alone when it cannot (an older host, or none).
  const sounds = createSnapshotStore<ChimeSound[]>([BUILT_IN_CHIME])
  const fetchSounds = async (): Promise<void> => {
    try {
      const response = await fetch(CHIME_SOUNDS_PATH)
      if (!response.ok) return
      const body = (await response.json()) as { sounds?: unknown }
      sounds.set(decodeChimeSounds(body.sounds))
    } catch {
      // offline or the route is absent: the built-in chime is always there
    }
  }
  void fetchSounds()

  // The output devices as a service, so other plugins (the feedback pane's
  // submit confirmation) raise the same chime + notification pair.
  const outputs: IdealizeNotify = {
    notify: (title, body) => { void notify(title, body) },
    chime: playChosen,
  }
  ctx.effect(() => {
    const dispose = ctx.reflect.provide('idealizeNotify', outputs)
    // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
    return () => { void dispose() }
  }, 'idealize-notify: output-device service')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'idealize-chime',
    order: 40,
    locale: NS,
    inject: (): ChimeRowInjected => ({
      hooks: { chime, sounds },
      setEnabled: (enabled) => {
        chime.set({ ...chime.getSnapshot(), enabled })
        void scope.set('chimeEnabled', enabled)
      },
      setVolume: (volume) => {
        chime.set({ ...chime.getSnapshot(), volume })
        void scope.set('chimeVolume', volume)
      },
      setSound: (sound) => {
        chime.set({ ...chime.getSnapshot(), sound })
        void scope.set('chimeSound', sound)
        // Heard at once: the choice is a sound, so the confirmation is the sound.
        void playChime(chime.getSnapshot().volume, sound)
      },
      preview: () => {
        requestNotificationPermission()
        const preference = chime.getSnapshot()
        void playChime(preference.volume, preference.sound)
      },
    }),
  }, ChimeRow))

  // ── The done chime and the Studio's alerts over the bridge feed ────────
  ctx.effect(() => {
    const gate = createChimeGate()
    let feed: BridgeFeedAttachment | undefined
    let closed = false
    const onAttention = (failed: boolean): void => {
      playChosen()
      if (failed) void notify(t('chime.notification.failedTitle'), t('chime.notification.failedBody'))
      else void notify(t('chime.notification.title'), t('chime.notification.body'))
    }
    const onAlert = (event: FeedEvent): void => {
      const studioEvent = event.studioEvent
      if (studioEvent === undefined || !alertsHere) return
      void notifyAttention(event.title, event.body, {
        open: () => {
          requestStudio(studioEvent)
          void recordAlertState(studioEvent, 'opened')
        },
        dismiss: () => { void recordAlertState(studioEvent, 'dismissed') },
      })
    }
    const attach = async (): Promise<void> => {
      // The window's one feed connection. Only events after attach chime; the
      // tail seeds the gate so history replayed at attach stays quiet.
      const attachment = await followBridgeFeed((frame) => {
        const event = frame as unknown as FeedEvent
        if (event.kind === 'attention') onAlert(event)
        if (gate.consider(event)) onAttention(event.failed === true)
      })
      // the bridge is absent in this composition: nothing to chime for
      if (attachment === undefined) return
      if (closed) { attachment.close(); return }
      gate.seed(attachment.tail.reduce((latest, event) => Math.max(latest, event.seq), 0))
      feed = attachment
    }
    void attach()
    return () => {
      closed = true
      feed?.close()
    }
  }, 'idealize-notify: done chime over the bridge feed')
}
