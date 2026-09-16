/**
 * The join that produces the Services list, pure: chat routes from the LLM
 * directory and generation backends from the generation registry, described
 * the same way and ordered together.
 * @module @idealize/services/join
 */

import { KEY_PAGES, orderMakes, orderServices, SERVICE_NAMES } from './directory.ts'
import type { ServiceMakes, ServiceRow } from './directory.ts'

/** One chat route as the LLM directory reports it, plus whether its key is stored. */
export interface ChatCandidate {
  provider: string
  displayName: string
  /** True while a stored credential resolves, or the route is signed into. */
  connected: boolean
  /** True while this route is reached by signing in rather than by pasting a key. */
  signIn?: boolean
}

/** One generation backend, plus the artefacts its catalogue currently offers. */
export interface MediaCandidate {
  backend: string
  displayName: string
  /** The credential environment name this backend resolves its key from. */
  env: string
  connected: boolean
  artefacts: readonly ('image' | 'video' | 'audio')[]
}

/**
 * A service's display name lower-cased and squeezed to letters and digits, so
 * `fal.ai` and `fal` reach the same key page. The route id is tried first and
 * this only where that misses.
 * @param name - the service's display name.
 * @returns the lookup stem.
 */
function stemOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * The key page for a service, by route id then by display-name stem. Absent
 * when neither is in {@link KEY_PAGES}: a wrong address is worse than none.
 * @param id - the route or backend id.
 * @param name - the display name.
 * @returns the key page URL, or undefined.
 */
export function keyPageFor(id: string, name: string): string | undefined {
  return KEY_PAGES[id] ?? KEY_PAGES[stemOf(name)]
}

/**
 * What to call a service. A registry that hands back a route id as its display
 * name gets the company's own name from {@link SERVICE_NAMES}; anything the
 * registry genuinely named keeps that name.
 * @param id - the route or backend id.
 * @param displayName - the name the registry reported.
 * @returns the name to show.
 */
export function serviceName(id: string, displayName: string): string {
  if (displayName !== id && displayName.trim() !== '') return displayName
  return SERVICE_NAMES[id] ?? displayName
}

/**
 * Join both registries into the one list the Services section renders.
 *
 * A service appearing in both — a company selling chat and images alike —
 * stays two rows, because the two keys are stored in different places and
 * either can be connected without the other. The rows carry the same name and
 * differ in what they say they make, which is the honest description of what
 * connecting each one buys.
 * @param chat - the chat routes the LLM directory declares.
 * @param media - the registered generation backends with their artefacts.
 * @returns the rows in display order.
 */
export function joinServices(
  chat: readonly ChatCandidate[],
  media: readonly MediaCandidate[],
): ServiceRow[] {
  const rows: ServiceRow[] = []
  for (const entry of chat) {
    const name = serviceName(entry.provider, entry.displayName)
    const keyUrl = keyPageFor(entry.provider, name)
    rows.push({
      id: entry.provider,
      kind: 'chat',
      name,
      makes: ['chat'],
      connected: entry.connected,
      ...keyUrl === undefined ? {} : { keyUrl },
      ...entry.signIn === true ? { signIn: true } : {},
    })
  }
  for (const entry of media) {
    const name = serviceName(entry.backend, entry.displayName)
    const keyUrl = keyPageFor(entry.backend, name)
    rows.push({
      id: entry.backend,
      kind: 'media',
      name,
      makes: orderMakes(entry.artefacts as ServiceMakes[]),
      connected: entry.connected,
      ...keyUrl === undefined ? {} : { keyUrl },
    })
  }
  return orderServices(rows)
}
