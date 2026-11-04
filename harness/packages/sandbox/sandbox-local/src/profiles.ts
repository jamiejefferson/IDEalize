/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { protectedAncestors, readDenialRules, writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { ReadDenialEnvironment, ReadMatch, ReadRule, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/** One rule's path filter as SBPL. */
function sbplFilter(match: ReadMatch): string {
  switch (match.kind) {
    case 'subpath': return `(subpath ${sbplString(match.path)})`
    case 'literal': return `(literal ${sbplString(match.path)})`
    case 'regex': return `(regex ${sbplString(match.pattern)})`
  }
}

/**
 * Express the shared read rules as SBPL. They use `file-read-data` so a stat
 * still works: Node's module loader and `realpath` walk every folder in a path,
 * and code under a closed folder could not load otherwise. A closed location
 * is also closed to writes, or a chat working in the home folder could move a
 * secret to a path the rules do not name, and its ancestors cannot be renamed
 * for the same reason.
 */
function sbplReadRules(rules: readonly ReadRule[], policy: SandboxPolicy): string[] {
  const forms: string[] = []
  const ancestors = protectedAncestors(rules)
  if (ancestors.length > 0) forms.push(`(deny file-write* ${ancestors.map(path => `(literal ${sbplString(path)})`).join(' ')})`)
  for (const rule of rules) {
    const filter = sbplFilter(rule.match)
    if (rule.effect === 'deny') {
      forms.push(`(deny file-read-data ${filter})`, `(deny file-write* ${filter})`)
    } else {
      forms.push(`(allow file-read-data ${filter})`)
      if (rule.workspace === true && policy.mode === 'workspace-write') forms.push(`(allow file-write* ${filter})`)
    }
  }
  return forms
}

/** No `open`, no Apple Events: the two routes from a confined command to a process outside the sandbox. */
const SEATBELT_NO_APP_LAUNCH = '(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.lsd.mapdb") (global-name "com.apple.lsd.modifydb") (global-name "com.apple.coreservices.quarantine-resolver")) (deny appleevent-send)'

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) and the closed locations from {@link readDenialRules}, so the
 * Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @param environment - overrides for the home folder and data folder the read rules name.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy, environment: ReadDenialEnvironment = {}): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  forms.push(...sbplReadRules(readDenialRules(policy, { platform: 'darwin', ...environment }), policy))
  if (policy.blockAppLaunch === true) forms.push(SEATBELT_NO_APP_LAUNCH)
  return ['-p', forms.join(' ')]
}
