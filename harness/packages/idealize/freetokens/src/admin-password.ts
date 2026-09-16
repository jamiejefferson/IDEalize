/**
 * The embedded sidecar's admin password, kept beside the account it unlocks.
 *
 * The account lives in the sidecar's own database under its data directory;
 * the password the host generated for it lives in the credential store. Those
 * are two different places, and the sidecar's setup endpoint runs exactly
 * once: lose the credential while the database survives and the host can
 * neither log in nor set up again, so the embedded sidecar stays down for
 * good. Writing the password into the data directory as well means the two
 * halves travel together, and a credential store that has been reset recovers
 * from the file instead of failing.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The file, inside the sidecar's data directory, holding the host's admin password. */
const FILE = 'host-admin.json'

/**
 * Read the password the host previously generated for this data directory.
 * @param dataDir - the sidecar's data directory.
 * @returns the password, or undefined when no readable record exists.
 */
export function readAdminPassword(dataDir: string): string | undefined {
  let raw: string
  try {
    raw = readFileSync(join(dataDir, FILE), 'utf8')
  } catch {
    // No record: a first run, or a data directory whose file was removed.
    // Both are answered by provisioning, not by failing here.
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { adminPassword?: unknown }
    return typeof parsed.adminPassword === 'string' && parsed.adminPassword !== ''
      ? parsed.adminPassword
      : undefined
  } catch {
    // A truncated or hand-edited file is the same situation as no file.
    return undefined
  }
}

/**
 * Record the password beside the account it unlocks, readable by this user only.
 * @param dataDir - the sidecar's data directory.
 * @param adminPassword - the password the host generated at setup.
 */
export function writeAdminPassword(dataDir: string, adminPassword: string): void {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, FILE)
  writeFileSync(path, `${JSON.stringify({ adminPassword }, null, 2)}\n`, 'utf8')
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows and some network filesystems reject POSIX modes; the file's
    // contents are already written and the directory is the user's own.
  }
}
