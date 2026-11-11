/** Shared preparation and verification inventory for Apple silicon macOS packages. */

import { chmodSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Native arm64 files that must be present inside app.asar.unpacked. */
export const MACOS_ARM64_NATIVE_ENTRIES = [
  'node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node',
  'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib',
  'node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node',
  'node_modules/@vscode/ripgrep-darwin-arm64/bin/rg',
  'node_modules/node-addon-require-builtin-darwin-arm64/prebuilt/darwin-arm64-napi-v9.node',
  'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
] as const

/**
 * Files a macOS package must never carry: a node-pty build that would shadow
 * its prebuilt module, and the Intel copies of the native modules. The app
 * ships for Apple silicon only (JJ, 11 Nov 2026), and the last pattern of
 * `mac.files` in the manifest keeps the Intel copies out.
 */
export const FORBIDDEN_MACOS_ENTRIES = [
  'node_modules/node-pty/build/Release/pty.node',
  'node_modules/node-pty/build/Release/spawn-helper',
  'node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64-0.35.5.node',
  'node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.18.7.dylib',
  'node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node',
  'node_modules/@vscode/ripgrep-darwin-x64/bin/rg',
  'node_modules/node-addon-require-builtin-darwin-x64/prebuilt/darwin-x64-napi-v9.node',
  'node_modules/node-pty/prebuilds/darwin-x64/pty.node',
  'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
] as const

/** Injectable filesystem seam for source-runtime preparation. */
export interface MacRuntimePreparationOptions {
  readonly desktopRoot: string
  readonly exists: (path: string) => boolean
  readonly chmod: (path: string, mode: number) => void
}

/**
 * Validate the arm64 runtime tree and restore the node-pty helper's execute bit.
 * Yarn intentionally disables lifecycle scripts, so the package step owns this
 * deterministic permission repair.
 * @param options - Desktop root and injectable filesystem operations.
 */
export function prepareMacRuntime(
  options: MacRuntimePreparationOptions,
): void {
  const root = resolve(options.desktopRoot)
  const missing = MACOS_ARM64_NATIVE_ENTRIES
    .map(entry => join(root, entry))
    .filter(path => !options.exists(path))
  if (missing.length > 0) {
    throw new Error(
      `macOS arm64 runtime is missing ${String(missing.length)} native file(s): ${missing.join(', ')}`,
    )
  }

  for (const entry of MACOS_ARM64_NATIVE_ENTRIES) {
    if (entry.endsWith('/spawn-helper')) {
      options.chmod(join(root, entry), 0o755)
    }
  }
}

/** Prepare the installed workspace dependency tree for macOS packaging. */
export function prepareInstalledMacRuntime(desktopRoot: string): void {
  prepareMacRuntime({ desktopRoot, exists: existsSync, chmod: chmodSync })
}
