import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  FORBIDDEN_MACOS_ENTRIES,
  MACOS_ARM64_NATIVE_ENTRIES,
  prepareMacRuntime,
} from '../scripts/mac-arm64.ts'

describe('macOS arm64 native runtime preparation', () => {
  it('requires every native file and repairs the node-pty helper', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when a native file is missing', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_ARM64_NATIVE_ENTRIES.at(-1)!

    expect(() => prepareMacRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })

  it('names no Intel file as required, and forbids the Intel copy of each native module', () => {
    expect(MACOS_ARM64_NATIVE_ENTRIES.filter(entry => /x64|x86_64/u.test(entry))).toEqual([])
    for (const entry of MACOS_ARM64_NATIVE_ENTRIES) {
      expect(FORBIDDEN_MACOS_ENTRIES).toContain(entry.replaceAll('arm64', 'x64'))
    }
  })
})
