/**
 * File-backed pi-ai credential store: one JSON document under the Harness
 * home, mode 0600, one credential per provider id. Writes serialize per
 * provider through a promise chain (pi-ai's InMemoryCredentialStore contract);
 * the whole-file write is atomic (temp file + rename) so a crash never leaves
 * a torn document holding refresh tokens.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

/** The store document filename inside the Harness home. */
export const OAUTH_STORE_FILENAME = '.idealize-oauth.json'

/**
 * Resolve the store path for one Harness home.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of the OAuth document under it.
 */
export function oauthStorePath(dshHome: string): string {
  return join(dshHome, OAUTH_STORE_FILENAME)
}

/** pi-ai's `CredentialStore` over one JSON document, with per-provider serialised writes. */
export class FileCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly path: string) {}

  private async readAll(): Promise<Record<string, Credential>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, Credential>
    } catch {
      return {}
    }
  }

  private async writeAll(all: Record<string, Credential>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    await rename(tmp, this.path)
    // Rename preserves the temp file's mode, but an operator-created
    // predecessor may have been looser; assert the final mode either way.
    await chmod(this.path, 0o600)
  }

  /** Serialize tasks per provider id. */
  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(providerId) ?? Promise.resolve()
    const next = prior.then(task, task)
    this.chains.set(providerId, next.catch(() => undefined))
    return next
  }

  read(providerId: string): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => (await this.readAll())[providerId])
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const all = await this.readAll()
    return Object.entries(all).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const all = await this.readAll()
      const next = await fn(all[providerId])
      const { [providerId]: _dropped, ...rest } = all
      await this.writeAll(next === undefined ? rest : { ...rest, [providerId]: next })
      return next
    })
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      const all = await this.readAll()
      if (!(providerId in all)) return
      const { [providerId]: _dropped, ...rest } = all
      await this.writeAll(rest)
    })
  }
}
