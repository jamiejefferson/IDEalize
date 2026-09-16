/** The `idealize-notify` settings section shared by the Host schema and the browser scope. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this plugin. */
export const NOTIFY_SETTINGS_NAMESPACE = 'idealize-notify'

/** Durable preferences: V0's `completionSoundEnabled`, `completionSoundVolume`, `lastSeenAnnouncementID`. */
export interface NotifySettings {
  /** Play the task-complete chime when an agent finishes. */
  chimeEnabled: boolean
  /** Chime volume, 0…1 (V0 default 0.4). */
  chimeVolume: number
  /** The id of the most recent announcement the user dismissed; empty until the first. */
  lastSeenAnnouncementId: string
}

/** Durable schema; also the wire envelope the browser scope validates against. */
export const NotifySettingsSchema: z<NotifySettings> = z.object({
  chimeEnabled: z.boolean().default(true),
  chimeVolume: z.number().min(0).max(1).default(0.4),
  lastSeenAnnouncementId: z.string().default(''),
})
