/**
 * Packaged builds refuse to start with a debugging switch: one of these gives
 * another program a socket into the app, with the app's microphone and folder
 * grants. A proof build keeps them, because agents test packaged builds through
 * them; `IDEALIZE_PROOF_BUILD=1` at packaging time writes the marker file, and
 * the release check refuses any build that carries it.
 *
 * The marker gives nothing an attacker lacks: anyone able to write inside the
 * bundle could already rewrite the code under `app.asar.unpacked`, and writing
 * either one breaks the signature the updater and installer check.
 */

/** The marker's name inside the bundle's Resources folder. */
export const PROOF_BUILD_MARKER = 'idealize-proof-build'

const DEBUG_SWITCHES = [
  'remote-debugging-port',
  'remote-debugging-pipe',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'inspect-brk-node',
  'inspect-publish-uid',
] as const

/** What the launch check needs to know about this launch. */
export interface DebugSwitchLaunch {
  readonly isPackaged: boolean
  readonly proofBuild: boolean
  readonly argv: readonly string[]
  /** Chromium's own reading of its command line, for spellings the plain scan misses. */
  readonly hasSwitch: (name: string) => boolean
}

/**
 * @param launch - this launch's facts.
 * @returns the switch that must stop this launch, or undefined when it may go on.
 */
export function refusedDebugSwitch(launch: DebugSwitchLaunch): string | undefined {
  if (!launch.isPackaged || launch.proofBuild) return undefined
  for (const name of DEBUG_SWITCHES) {
    if (launch.hasSwitch(name)) return name
    // Chromium accepts one dash as readily as two, and any letter case on the name is not a switch it knows.
    const form = new RegExp(`^--?${name}(?:=|$)`, 'u')
    if (launch.argv.some(argument => form.test(argument))) return name
  }
  return undefined
}
