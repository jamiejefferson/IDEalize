/**
 * Where a chat route's profile lives, and the credential name it records.
 *
 * Each route belongs to the adapter that serves it, and that adapter keeps the
 * route's profile in its own settings section: pi-ai under
 * `llm-pi-ai.providers.<id>`, DeepSeek's own adapter as the whole `llm-deepseek`
 * section. The configurable-provider directory names both. Reading every route
 * from the pi-ai section missed DeepSeek's key, and writing it there was
 * refused (JJ, 30 Oct 2026).
 * @module @idealize/services/chat-profile
 */

import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Where a chat route's profile lives, as the configurable-provider directory names it. */
export interface ChatRoute {
  /** The owning adapter's settings namespace (`llm-pi-ai`, `llm-deepseek`). */
  settingsNs: string
  /** Path from that section's root to the profile; empty when the section is the profile. */
  settingsPath: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The route's profile as its adapter's section resolves it.
 * @param read - the settings read (`ctx.settings.get`).
 * @param route - the route's directory entry.
 * @returns the profile object, or undefined while the section or path is absent.
 */
export function chatProfileOf(read: (ns: SettingsNamespace) => unknown, route: ChatRoute): Record<string, unknown> | undefined {
  let node: unknown = read(settingsNamespace(route.settingsNs))
  for (const key of route.settingsPath) node = isRecord(node) ? node[key] : undefined
  return isRecord(node) ? node : undefined
}

/**
 * The credential name the route's profile records, including a default its
 * adapter's schema fills in.
 * @param read - the settings read (`ctx.settings.get`).
 * @param route - the route's directory entry.
 * @returns the name, or undefined when the profile names none.
 */
export function recordedKeyEnv(read: (ns: SettingsNamespace) => unknown, route: ChatRoute): string | undefined {
  const recorded = chatProfileOf(read, route)?.['apiKeyEnv']
  return typeof recorded === 'string' && recorded !== '' ? recorded : undefined
}
