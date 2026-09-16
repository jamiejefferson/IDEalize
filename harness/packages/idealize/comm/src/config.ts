/**
 * The comm plugin's settings section: the preset→role mapping plus the
 * window the finished-work safety net waits before it reports a background
 * generation's artefacts as one Studio line.
 * @module @idealize/comm/src/config
 */

import { DEFAULT_ROLE_CONFIG } from './roles.ts'
import type { RoleConfig } from './roles.ts'

/** The settings-backed comm configuration (`idealize-comm` namespace). */
export interface CommConfig extends RoleConfig {
  /**
   * Milliseconds the safety net waits after an `artefact/created` event that
   * lands with no open turn before it posts one Studio line for the batch.
   * A background job that produces several outputs commits them in
   * succession; every further artefact inside the window restarts it, so the
   * batch reads as one line. Zero posts on the next tick.
   */
  backgroundPostDelayMs: number
}

/** The composition entry when cordis.yml sets nothing. */
export const DEFAULT_COMM_CONFIG: CommConfig = { ...DEFAULT_ROLE_CONFIG, backgroundPostDelayMs: 2000 }
