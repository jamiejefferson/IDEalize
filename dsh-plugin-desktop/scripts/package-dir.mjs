/**
 * Build an unpacked application for the current host platform. On a Mac that
 * holds the local signing certificate, the app is signed with it.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signMacApp } from './sign-with-certificate.ts'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')
// The manifest's product name and bundle id (IDEalize V1, ai.projject.idealize.v1)
// keep the packaged app and its data apart from the Swift V0 app installed as
// /Applications/IDEalize.app; the release DMG carries the same identity.
const result = spawnSync(process.execPath, [
  builderCli,
  '--dir',
], {
  cwd: packageRoot,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
if (result.status !== 0) {
  throw new Error(`electron-builder --dir exited with ${String(result.status)}`)
}

// An unsigned bundle has no identity macOS can recognise, so every launch asked
// again for each protected folder (JJ, 17 Sep 2026: "maybe 20 times") and a
// Screen Recording grant never took. The certificate is the same across builds,
// so a grant given once survives restarts and later landings. The signing is
// the release's own, with the hardened runtime and its entitlements, so a local
// landing behaves as a release does.
const SIGN_ID = 'IDEalize Local Signing'
const app = join(packageRoot, 'dist', `mac-${process.arch}`, 'IDEalize V1.app')
if (process.platform === 'darwin' && existsSync(app)) {
  const identities = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout ?? ''
  if (identities.includes(`"${SIGN_ID}"`)) {
    signMacApp(app, SIGN_ID)
    console.log(`Signed with "${SIGN_ID}".`)
  } else {
    console.log(`No "${SIGN_ID}" certificate in the keychain; the app stays unsigned and macOS will re-ask for folder access on every launch.`)
  }
}
