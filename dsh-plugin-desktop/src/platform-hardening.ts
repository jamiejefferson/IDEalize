/**
 * Which platforms take the November 2026 security changes that alter how the
 * running app behaves. JJ decides any Windows change (brief, 4 Nov 2026), and
 * Martin looks after Windows, so this is the one place to widen them: add
 * `win32` here and every check below follows.
 *
 * Covers refusing debug switches, keeping the app up after an uncaught
 * exception, the permission rules, Powell's navigation guard, the keys-file and
 * project-link confirmations, and the rules on what opening a path may do.
 * The updater's certificate check and the packaging changes are macOS-only by
 * nature and stay out of this switch.
 */

/** The platforms the hardening applies to. */
export const HARDENED_PLATFORMS: readonly NodeJS.Platform[] = ['darwin']

/**
 * @param platform - the platform to ask about.
 * @returns whether the behaviour changes apply there.
 */
export function hardeningApplies(platform: NodeJS.Platform): boolean {
  return HARDENED_PLATFORMS.includes(platform)
}
