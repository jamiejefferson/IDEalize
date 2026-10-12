/**
 * Files the app never reads, writes, lists or serves through its own routes,
 * whichever window asks: keys, credentials and shell history. The Files pane
 * browses the whole home folder, so before 1.0.15 its routes returned
 * `~/.ssh/config` and the app's own key store to any caller (security audit,
 * 9 Oct 2026).
 * @module @idealize/ui-bar/secret-paths
 */

import { join, sep } from 'node:path'

/** Folders under home whose whole contents stay closed. */
const SECRET_HOME_FOLDERS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure', '.config/gcloud', '.config/gh', 'Library/Keychains'] as const

/** Single files under home that stay closed. */
const SECRET_HOME_FILES = ['.netrc', '.npmrc', '.pypirc', '.git-credentials', '.zsh_history', '.bash_history', '.python_history', '.node_repl_history', '.psql_history', '.mysql_history'] as const

/** The app's own key stores, inside its data folder. */
const SECRET_APP_ENTRIES = ['.credentials.yaml', '.idealize-oauth.json', 'freetokens-data'] as const

/**
 * Whether a resolved path is, or sits inside, a secret location.
 * @param resolved - an absolute, realpath-resolved path.
 * @param home - the home folder.
 * @param dshHome - the app's data folder (the harness home).
 * @returns true when the routes must refuse it.
 */
export function isSecretPath(resolved: string, home: string, dshHome: string): boolean {
  const within = (root: string): boolean => resolved === root || resolved.startsWith(root + sep)
  if (SECRET_HOME_FOLDERS.some(folder => within(join(home, folder)))) return true
  if (SECRET_HOME_FILES.some(file => resolved === join(home, file))) return true
  return SECRET_APP_ENTRIES.some(entry => within(join(dshHome, entry)))
}
