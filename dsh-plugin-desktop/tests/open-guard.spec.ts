import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideOpen, openGuarded, runsWhenOpened } from '../src/open-guard.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function actions() {
  return { openPath: vi.fn(async () => ''), openExternal: vi.fn(async () => undefined) }
}

describe("Powell's Open button", () => {
  it.each([
    '/tmp/x.command', '/tmp/x.COMMAND', '/tmp/x.app', '/tmp/x.tool', '/tmp/x.pkg', '/tmp/x.scpt', '/tmp/x.workflow',
    '/tmp/x.terminal', '/tmp/x.dmg', '/tmp/x.sh', '/tmp/x.webloc', '/tmp/x.command.', '/tmp/x.app/', 'C:\\x\\run.exe',
  ])('replays the poisoned reply [open: %s] and runs nothing', async (target) => {
    const shell = actions()
    expect(await openGuarded(target, shell)).toContain('would run as a program')
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'http://attacker.example/', 'file:///tmp/x.command', 'ssh://attacker.example', 'vscode://x', 'idealize://project?path=/',
    'javascript:alert(1)', 'smb://attacker.example/share', 'https://user:pass@attacker.example/',
  ])('refuses the address %s', async (target) => {
    const shell = actions()
    expect(await openGuarded(target, shell)).toContain('only https')
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('sends https to the browser and an ordinary document to its app', async () => {
    const shell = actions()
    await expect(openGuarded('https://example.com/a?b=1', shell)).resolves.toBe('')
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/a?b=1')
    await expect(openGuarded('/Users/me/Work/brief.pdf', shell)).resolves.toBe('')
    expect(shell.openPath).toHaveBeenCalledWith('/Users/me/Work/brief.pdf')
  })

  it('refuses an extension-less executable and allows an extension-less document', async () => {
    const root = mkdtempSync(join(tmpdir(), 'idealize-open-'))
    roots.push(root)
    const tool = join(root, 'tool')
    writeFileSync(tool, '#!/bin/sh\n')
    chmodSync(tool, 0o755)
    const notes = join(root, 'notes')
    writeFileSync(notes, 'text')
    chmodSync(notes, 0o644)
    await expect(runsWhenOpened(tool)).resolves.toBe(true)
    await expect(runsWhenOpened(notes)).resolves.toBe(false)
    await expect(runsWhenOpened(root)).resolves.toBe(false)
    expect((await decideOpen(root)).kind).toBe('path')
  })
})
