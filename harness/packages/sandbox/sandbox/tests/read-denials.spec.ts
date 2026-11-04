/**
 * The rule list a confined chat's kernel profile and read tools share: which
 * paths close, which stay open, and the order that makes both true at once.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isReadDenied, protectedAncestors, readDenialRules, searchReachesDenied } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'

const home = '/Users/person'
const app = `${home}/Library/Application Support/IDEalize V1`
const dataHome = `${app}/harness`
const environment = { home, dataHome, platform: 'darwin' as const }
const policy: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: `${home}/project` }
const rules = readDenialRules(policy, environment)

describe('readDenialRules', () => {
  it.each([
    `${dataHome}/.credentials.yaml`,
    `${dataHome}/.credentials.yaml.bak-20260825`,
    `${dataHome}/.idealize-oauth.json`,
    `${dataHome}/.env`,
    `${dataHome}/settings.yaml`,
    `${dataHome}/cordis.patch.yml`,
    `${dataHome}/freetokens-data/.encryption-key`,
    `${dataHome}/freetokens-data/host-admin.json`,
    `${dataHome}/sessions/project/session-a/log.jsonl`,
    `${dataHome}/profiles/desktop/.env`,
    `${dataHome}/profiles/desktop/bridge.pem`,
    `${app}/Cookies`,
    `${app}/Local Storage/leveldb/000.log`,
    `${home}/Library/Application Support/IDEalize Dev/harness/.credentials.yaml`,
    `${home}/.dsh/.credentials.yaml`,
    `${home}/.idealize/triage.env`,
    `${home}/.idealize-signing/idealize-signing.p12`,
    `${home}/.aws/credentials`,
    `${home}/.gnupg/pubring.kbx`,
    `${home}/Library/Keychains/login.keychain-db`,
    `${home}/.zsh_history`,
    `${home}/.bash_history`,
    `${home}/.netrc`,
    `${home}/.git-credentials`,
    `${home}/.ssh/id_ed25519`,
    `${home}/.ssh/id_rsa`,
    `${home}/.ssh/work.pem`,
  ])('closes %s', (path) => {
    expect(isReadDenied(path, rules, 'darwin')).toBe(true)
  })

  it.each([
    `${dataHome}/profiles/desktop/node_modules/plugin/index.js`,
    `${dataHome}/.agent-presets/coding/preset.yml`,
    `${dataHome}/skills/mine/SKILL.md`,
    `${dataHome}/idealize/skill-packages/pack/SKILL.md`,
    `${dataHome}/idealize/comm-host.json`,
    `${app}/runtime-commands/bin/idealize`,
    `${home}/.ssh/config`,
    `${home}/.ssh/known_hosts`,
    `${home}/.ssh/id_ed25519.pub`,
    `${home}/.config/gh/hosts.yml`,
    `${home}/project/.env`,
    `${home}/Documents/brief.md`,
    '/usr/bin/git',
  ])('leaves %s open', (path) => {
    expect(isReadDenied(path, rules, 'darwin')).toBe(false)
  })

  it('takes every path from the resolved home and data folder', () => {
    const elsewhere = readDenialRules(policy, { home: '/home/other', dataHome: '/data/app/harness', platform: 'darwin' })
    expect(isReadDenied('/data/app/harness/.credentials.yaml', elsewhere, 'darwin')).toBe(true)
    expect(isReadDenied('/data/app/Cookies', elsewhere, 'darwin')).toBe(true)
    expect(isReadDenied('/home/other/.aws/credentials', elsewhere, 'darwin')).toBe(true)
    expect(isReadDenied(`${home}/.aws/credentials`, elsewhere, 'darwin')).toBe(false)
  })

  it('reopens only the calling chat\'s own session log', () => {
    const own = readDenialRules({ ...policy, sessionId: 'session-a' as never }, environment)
    expect(isReadDenied(`${dataHome}/sessions/project/session-a/log.jsonl`, own, 'darwin')).toBe(false)
    expect(isReadDenied(`${dataHome}/sessions/project/session-b/log.jsonl`, own, 'darwin')).toBe(true)
    expect(isReadDenied(`${dataHome}/sessions/project/session-ab/log.jsonl`, own, 'darwin')).toBe(true)
  })

  it('opens a working folder inside the data folder, and keeps the key stores closed from it', () => {
    const powell = readDenialRules({ mode: 'workspace-write', workspaceRoot: `${dataHome}/idealize/powell/home` }, environment)
    expect(isReadDenied(`${dataHome}/idealize/powell/home/notes.md`, powell, 'darwin')).toBe(false)
    expect(isReadDenied(`${dataHome}/idealize/powell/state.json`, powell, 'darwin')).toBe(true)
    expect(isReadDenied(`${dataHome}/.credentials.yaml`, powell, 'darwin')).toBe(true)
  })

  it('does not open the whole data folder to a chat working in it', () => {
    const atHome = readDenialRules({ mode: 'workspace-write', workspaceRoot: dataHome }, environment)
    expect(isReadDenied(`${dataHome}/settings.yaml`, atHome, 'darwin')).toBe(true)
    const atApp = readDenialRules({ mode: 'workspace-write', workspaceRoot: app }, environment)
    expect(isReadDenied(`${app}/Cookies`, atApp, 'darwin')).toBe(true)
  })

  it('keeps everything closed for a chat working in the home folder', () => {
    const atHome = readDenialRules({ mode: 'workspace-write', workspaceRoot: home }, environment)
    expect(isReadDenied(`${home}/.ssh/id_ed25519`, atHome, 'darwin')).toBe(true)
    expect(isReadDenied(`${dataHome}/.credentials.yaml`, atHome, 'darwin')).toBe(true)
  })

  it('closes a key the SSH config names, and leaves a public key it names open', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-read-rules-')))
    mkdirSync(join(base, '.ssh'))
    writeFileSync(join(base, '.ssh', 'config'), 'Host a\n  IdentityFile ~/keys/work\n  IdentityFile = "other_key"\n  IdentityFile ~/.ssh/agent-only.pub\n  IdentityFile none\n')
    const named = readDenialRules(policy, { home: base, dataHome: `${base}/data`, platform: 'darwin' })
    expect(isReadDenied(join(base, 'keys', 'work'), named, 'darwin')).toBe(true)
    expect(isReadDenied(join(base, '.ssh', 'other_key'), named, 'darwin')).toBe(true)
    expect(isReadDenied(join(base, '.ssh', 'agent-only.pub'), named, 'darwin')).toBe(false)
  })

  it('matches another case on macOS and an exact case on Linux', () => {
    expect(isReadDenied(`${home}/.SSH/ID_RSA`, rules, 'darwin')).toBe(true)
    const linux = readDenialRules(policy, { home, dataHome, platform: 'linux' })
    expect(isReadDenied(`${home}/.ssh/id_rsa`, linux, 'linux')).toBe(true)
    expect(isReadDenied(`${home}/.SSH/ID_RSA`, linux, 'linux')).toBe(false)
  })

  it('has no rules under full access, and none on Windows', () => {
    expect(readDenialRules({ ...policy, mode: 'danger-full-access' }, environment)).toEqual([])
    expect(readDenialRules(policy, { ...environment, platform: 'win32' })).toEqual([])
  })

  it('lets the owner reopen a path', () => {
    const reopened = readDenialRules({ ...policy, readAllowed: [`${home}/.aws`] }, environment)
    expect(isReadDenied(`${home}/.aws/credentials`, reopened, 'darwin')).toBe(false)
    expect(isReadDenied(`${home}/.gnupg/key`, reopened, 'darwin')).toBe(true)
  })
})

describe('searchReachesDenied', () => {
  it('refuses a search that would walk into a visible closed folder', () => {
    expect(searchReachesDenied(home, rules)).toBe(true)
    expect(searchReachesDenied(`${home}/Library`, rules)).toBe(true)
  })

  it('allows a search in a project, and one whose only route crosses a hidden folder', () => {
    expect(searchReachesDenied(`${home}/project`, rules)).toBe(false)
    const hidden = readDenialRules(policy, { home, dataHome: `${home}/.hidden/app/harness`, platform: 'linux' })
    expect(searchReachesDenied(home, hidden)).toBe(false)
    expect(searchReachesDenied(`${home}/.hidden`, hidden)).toBe(true)
  })
})

describe('protectedAncestors', () => {
  it('names the folders above a closed location, so renaming one cannot move a secret out of the rules', () => {
    const ancestors = protectedAncestors(rules)
    expect(ancestors).toContain(home)
    expect(ancestors).toContain(`${home}/Library`)
    expect(ancestors).toContain(`${home}/Library/Application Support`)
    expect(ancestors).toContain(`${home}/.ssh`)
  })
})
