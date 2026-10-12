import { describe, expect, it } from 'vitest'
import { isSecretPath } from '../src/secret-paths.ts'

describe('secret paths the Files routes refuse', () => {
  const home = '/Users/jj'
  const dshHome = '/Users/jj/.idealize'
  it('closes key folders, history files and the app key stores', () => {
    for (const path of ['/Users/jj/.ssh', '/Users/jj/.ssh/config', '/Users/jj/.aws/credentials', '/Users/jj/.config/gh/hosts.yml', '/Users/jj/Library/Keychains/login.keychain-db', '/Users/jj/.zsh_history', '/Users/jj/.idealize/.credentials.yaml', '/Users/jj/.idealize/freetokens-data/admin.json']) {
      expect(isSecretPath(path, home, dshHome), path).toBe(true)
    }
  })
  it('leaves ordinary files and look-alike names open', () => {
    for (const path of ['/Users/jj/Documents/plan.md', '/Users/jj/.sshrc', '/Users/jj/.zsh_history_notes/x', '/Users/jj/.idealize/sessions', '/Users/jj/Projects/.ssh-notes.md']) {
      expect(isSecretPath(path, home, dshHome), path).toBe(false)
    }
  })
})
