/**
 * What a confined chat may not read: the person's stored keys, shell history
 * and the app's data folder. This module is the rule list's one home. The
 * Seatbelt profile (`@deepseek-ai/dsh-sandbox-local`) and the in-process read
 * fence (`@deepseek-ai/dsh-fs-sandbox`) both evaluate these rules, so a secret
 * the shell cannot read is a secret the read tools cannot read either.
 *
 * Rules run in order and the last match wins, which is Seatbelt's own
 * semantics. The list has four layers:
 *
 * 1. Every app data folder is closed: the running app's, its Electron folder,
 *    the default `~/.dsh`, and any other IDEalize install on the machine.
 * 2. What a chat needs from the running app's folder reopens: the commands on
 *    its PATH, plugin code, skills, presets, its own session log, and its
 *    working folder when that sits inside the data folder (Powell's does).
 * 3. Key files close again, so a reopened folder can never expose one.
 * 4. Secrets in the home folder close: login folders, credential files, shell
 *    history, and SSH private keys. `config`, `known_hosts`, `*.pub` and the
 *    agent socket stay usable, so `git push` over SSH keeps working through
 *    the agent.
 *
 * The owner can reopen a path with `readAllowed` on `dsh-sandbox-policy`.
 * Windows has no rules: its ACL runner has no read denial, and its behaviour
 * is unchanged.
 *
 * @module dsh-sandbox/read-denials
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SandboxExecutionPolicy } from './index.ts'
import { canonicalPath } from './roots.ts'

/** How one rule matches a canonical path. */
export type ReadMatch =
  | { kind: 'subpath'; path: string }
  | { kind: 'literal'; path: string }
  /** An anchored regular expression; `root` names the folder it can only match under. */
  | { kind: 'regex'; pattern: string; root: string }

/** One ordered rule. The last rule that matches a path decides it. */
export interface ReadRule {
  effect: 'deny' | 'allow'
  match: ReadMatch
  /** Set on the working-folder allow: it also reopens writes, which only that folder gets. */
  workspace?: true
}

/** Where the rules look. Everything defaults to the running process's own home and data folder. */
export interface ReadDenialEnvironment {
  /** The person's home folder. */
  home?: string
  /** The app's data folder (the harness home). */
  dataHome?: string
  /** The platform the rules are for. */
  platform?: NodeJS.Platform
}

/**
 * Whole folders under home that hold logins and keys. `.config/gh` is left out
 * on purpose: `gh` refuses to start at all when it cannot read `hosts.yml`, and
 * by default its token lives in the Keychain, so closing the folder would cost
 * every chat `gh` to protect only people who chose plaintext storage.
 */
const SECRET_HOME_FOLDERS = ['.aws', '.gnupg', '.kube', '.docker', '.azure', '.config/gcloud', '.idealize', '.idealize-signing', '.zsh_sessions', '.bash_sessions'] as const

/** Single credential and shell history files under home. */
const SECRET_HOME_FILES = [
  '.netrc', '.npmrc', '.pypirc', '.git-credentials',
  '.zsh_history', '.bash_history', '.sh_history', '.histfile', '.python_history', '.node_repl_history', '.psql_history', '.mysql_history', '.sqlite_history', '.local/share/fish/fish_history',
] as const

/** The private key file names SSH uses by default, and the suffixes key files commonly carry. */
const SSH_KEY_NAME = String.raw`id_[^/]*`
const KEY_SUFFIX = String.raw`[^/]*\.(pem|key|p12|pfx|ppk)`

/** The app's own key stores inside its data folder. */
const SECRET_DATA_ENTRIES = ['freetokens-data'] as const

/** The start of a key store's name; backups such as `.credentials.yaml.bak` close with it. */
const SECRET_DATA_NAMES = [String.raw`\.credentials\.yaml[^/]*`, String.raw`\.idealize-oauth\.json[^/]*`] as const

/** Folders inside the harness home a chat needs: plugin code, presets and skills. */
const OPEN_DATA_FOLDERS = ['profiles', '.agent-presets', 'skills', join('idealize', 'skill-packages')] as const

/** Single files inside the harness home a chat needs: where the `idealize` command finds the app. */
const OPEN_DATA_FILES = [join('idealize', 'comm-host.json')] as const

/** Folders beside the harness home a chat needs: the commands on its PATH. */
const OPEN_APP_FOLDERS = ['runtime-commands', 'cli'] as const

/** Escape one path for a regular expression both Seatbelt and JavaScript read the same way. */
function regexEscape(path: string): string {
  return path.replaceAll(/[.*+?^$()[\]{}|\\]/g, String.raw`\$&`)
}

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

function deny(match: ReadMatch): ReadRule {
  return { effect: 'deny', match }
}

function allow(match: ReadMatch): ReadRule {
  return { effect: 'allow', match }
}

const subpath = (path: string): ReadMatch => ({ kind: 'subpath', path })
const literal = (path: string): ReadMatch => ({ kind: 'literal', path })
const regex = (root: string, tail: string): ReadMatch => ({ kind: 'regex', root, pattern: `^${regexEscape(root)}/${tail}` })

/**
 * The Electron folder that holds the harness home, when it has that shape.
 * Desktop stores the harness home at `<userData>/harness`, with cookies and
 * browser storage beside it.
 */
function appFolderOf(dataHome: string, home: string): string | undefined {
  if (basename(dataHome) !== 'harness') return undefined
  const parent = dirname(dataHome)
  return parent === home || under(home, parent) ? undefined : parent
}

/**
 * Private key files `~/.ssh/config` names, so a key called something other
 * than `id_*` closes too. A file that is missing or unreadable names nothing.
 */
function sshConfigKeys(home: string): string[] {
  let text: string
  try {
    text = readFileSync(join(home, '.ssh', 'config'), 'utf8')
  } catch {
    return []
  }
  const keys: string[] = []
  for (const line of text.split('\n').slice(0, 2000)) {
    const named = /^\s*IdentityFile[\s=]+"?([^"\n]+?)"?\s*$/i.exec(line)?.[1]
    if (named === undefined || named.toLowerCase() === 'none' || named.endsWith('.pub') || named.includes('%')) continue
    if (named.startsWith('~/')) keys.push(join(home, named.slice(2)))
    else if (named.startsWith('/')) keys.push(named)
    else keys.push(join(home, '.ssh', named), join(home, named))
  }
  return keys
}

/**
 * The rules for one confined call, in order. Empty under full access and on
 * Windows.
 * @param policy - the call's resolved policy.
 * @param environment - overrides for the home folder, data folder and platform.
 * @returns the ordered rules; the last that matches a path decides it.
 */
export function readDenialRules(policy: SandboxExecutionPolicy, environment: ReadDenialEnvironment = {}): ReadRule[] {
  const platform = environment.platform ?? process.platform
  if (policy.mode === 'danger-full-access' || platform === 'win32') return []
  const home = canonicalPath(environment.home ?? homedir())
  const dataHome = canonicalPath(environment.dataHome ?? resolveDshHome())
  const appFolder = appFolderOf(dataHome, home)
  const workspace = canonicalPath(policy.workspaceRoot)
  const rules: ReadRule[] = []

  // 1. Close every app data folder.
  const closed = [...new Set([dataHome, ...appFolder === undefined ? [] : [appFolder], join(home, '.dsh')])]
  for (const folder of closed) rules.push(deny(subpath(folder)))
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    rules.push(deny(regex(support, String.raw`(IDEalize|DSH Desktop)[^/]*(/|$)`)))
  }

  // 2. Reopen what a chat needs from the running app's folder.
  for (const folder of OPEN_DATA_FOLDERS) rules.push(allow(subpath(join(dataHome, folder))))
  for (const file of OPEN_DATA_FILES) rules.push(allow(literal(join(dataHome, file))))
  if (appFolder !== undefined) for (const folder of OPEN_APP_FOLDERS) rules.push(allow(subpath(join(appFolder, folder))))
  if (policy.sessionId !== undefined) {
    rules.push(allow(regex(join(dataHome, 'sessions'), `[^/]+/${regexEscape(policy.sessionId)}(/|\\.|$)`)))
  }

  // `.env` files in the reopened folders stay closed; a working folder's own
  // come back below, since its project is the chat's to read.
  const everyAppFolder = appFolder ?? dataHome
  rules.push(deny(regex(everyAppFolder, String.raw`(.*/)?(\.env(\.[^/]*)?|[^/]*\.env)$`)))
  rules.push(deny(regex(everyAppFolder, `(.*/)?${KEY_SUFFIX}$`)))

  const insideData = closed.some(folder => workspace !== folder && under(workspace, folder))
  const holdsHarness = under(dataHome, workspace)
  if (insideData && !holdsHarness) rules.push({ ...allow(subpath(workspace)), workspace: true })

  // 3. Key stores close whatever reopened above.
  for (const entry of SECRET_DATA_ENTRIES) rules.push(deny(subpath(join(dataHome, entry))))
  for (const name of SECRET_DATA_NAMES) rules.push(deny(regex(dataHome, `${name}$`)))

  // 4. Secrets under home.
  for (const folder of SECRET_HOME_FOLDERS) rules.push(deny(subpath(join(home, folder))))
  for (const file of SECRET_HOME_FILES) rules.push(deny(literal(join(home, file))))
  if (platform === 'darwin') rules.push(deny(subpath(join(home, 'Library', 'Keychains'))))
  const ssh = join(home, '.ssh')
  rules.push(deny(regex(ssh, `(${SSH_KEY_NAME}|${KEY_SUFFIX})$`)))
  for (const key of sshConfigKeys(home)) rules.push(deny(literal(canonicalPath(key))))
  rules.push(allow(regex(ssh, String.raw`[^/]*\.pub$`)))

  // The owner's own exceptions come last, so they reopen anything above.
  for (const path of policy.readAllowed ?? []) rules.push(allow(subpath(canonicalPath(expandHomePath(path)))))
  return rules
}

function matches(match: ReadMatch, path: string): boolean {
  switch (match.kind) {
    case 'subpath': return under(path, match.path)
    case 'literal': return path === match.path
    case 'regex': return new RegExp(match.pattern).test(path)
  }
}

function foldMatch(match: ReadMatch): ReadMatch {
  return match.kind === 'regex'
    ? { ...match, pattern: match.pattern.toLowerCase(), root: match.root.toLowerCase() }
    : { ...match, path: match.path.toLowerCase() }
}

/**
 * Whether the rules refuse reading one path, by the same last-match-wins
 * evaluation the Seatbelt profile gets from the kernel.
 * @param path - a canonical absolute path.
 * @param rules - the ordered rules from {@link readDenialRules}.
 * @param platform - the platform, for case folding.
 * @returns true when the last matching rule denies.
 */
export function isReadDenied(path: string, rules: readonly ReadRule[], platform: NodeJS.Platform = process.platform): boolean {
  // macOS folders are normally case-insensitive, so `~/.SSH` names `~/.ssh`.
  const fold = platform !== 'linux'
  const target = fold ? path.toLowerCase() : path
  let denied = false
  for (const rule of rules) {
    if (matches(fold ? foldMatch(rule.match) : rule.match, target)) denied = rule.effect === 'deny'
  }
  return denied
}

/**
 * Whether a search walking down from `root` would reach a closed folder.
 * `grep` skips hidden names, so only a route with no hidden step counts.
 * @param root - the canonical folder the search starts in.
 * @param rules - the ordered rules from {@link readDenialRules}.
 * @returns true when the walk would pass through a closed location.
 */
export function searchReachesDenied(root: string, rules: readonly ReadRule[]): boolean {
  return rules.some((rule) => {
    if (rule.effect !== 'deny' || rule.match.kind === 'literal') return false
    const denied = rule.match.kind === 'subpath' ? rule.match.path : rule.match.root
    if (denied === root || !under(denied, root)) return false
    return !relative(root, denied).split(sep).some(step => step.startsWith('.'))
  })
}

/**
 * The folders above a closed location. Renaming one would move the secret to a
 * path the rules no longer name, so a chat working in the home folder must not
 * be able to rename them.
 * @param rules - the ordered rules from {@link readDenialRules}.
 * @returns the canonical ancestor folders, deepest and shallowest alike.
 */
export function protectedAncestors(rules: readonly ReadRule[]): string[] {
  const found = new Set<string>()
  for (const rule of rules) {
    if (rule.effect !== 'deny') continue
    let current = rule.match.kind === 'regex' ? rule.match.root : rule.match.path
    for (let parent = dirname(current); parent !== current; current = parent, parent = dirname(current)) found.add(parent)
    if (rule.match.kind === 'regex') found.add(rule.match.root)
  }
  return [...found]
}

/** Plain words for a refused read, for the model and the person behind it. */
export const READ_DENIED_REASON = 'That file is closed to this chat: it holds keys, or sits in the app\'s private data. Ask the person to do this themselves, or to switch this chat to Full access if they want it to go ahead.'
