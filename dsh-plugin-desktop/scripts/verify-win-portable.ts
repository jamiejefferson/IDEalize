/** Verify the unsigned Windows x64 portable ZIP archive. */

import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { assertPortableExecutableBuffer, readWindowsProductManifest } from './verify-win-installer.ts'

/** Injectable Windows portable verification boundary. */
export interface WindowsPortableVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
  /** Electron Builder `productName`, which names the archived executable. */
  readonly productName: string
}

function defaultOptions(): WindowsPortableVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return { desktopRoot, ...readWindowsProductManifest(desktopRoot) }
}

/** Verify the exact versioned portable archive and its application entry. */
export function verifyWindowsPortable(
  options: WindowsPortableVerificationOptions = defaultOptions(),
): string {
  const portablePath = join(
    options.desktopRoot,
    'dist',
    `IDEalize-${options.version}-x64-Portable.zip`,
  )
  const stat = statSync(portablePath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Windows portable archive is not a non-empty regular file: ${portablePath}`)
  }
  const archive = new AdmZip(portablePath)
  const entries = archive.getEntries().filter(entry => !entry.isDirectory)
  const executableName = `${options.productName}.exe`
  const executable = entries.find(entry => entry.entryName.replaceAll('\\', '/') === executableName)
  if (executable === undefined) {
    throw new Error(`Windows portable archive is missing ${executableName}: ${portablePath}`)
  }
  if (!entries.some(entry => entry.entryName.replaceAll('\\', '/') === 'resources/app.asar')) {
    throw new Error(`Windows portable archive is missing resources/app.asar: ${portablePath}`)
  }
  assertPortableExecutableBuffer(
    executable.getData(),
    'Windows portable application',
    `${portablePath}:${executableName}`,
  )
  return portablePath
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Windows portable verification passed: ${verifyWindowsPortable()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
