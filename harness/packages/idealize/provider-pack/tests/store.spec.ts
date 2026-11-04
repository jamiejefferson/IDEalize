/**
 * The credential document: one JSON file at mode 0600, per-provider writes
 * that serialize, and an unreadable file that reads as no credentials rather
 * than failing the caller.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModels } from '@earendil-works/pi-ai'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it } from 'vitest'
import { FileCredentialStore, OAUTH_STORE_FILENAME, oauthStorePath } from '../src/index.ts'

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** A store over a fresh scratch home. */
async function store(): Promise<{ store: FileCredentialStore; path: string }> {
  const home = await mkdtemp(join(tmpdir(), 'idealize-oauth-'))
  homes.push(home)
  const path = oauthStorePath(home)
  return { store: new FileCredentialStore(path), path }
}

const credential = (token: string): Credential => ({ type: 'oauth', access: token, refresh: 'r', expires: 0 })

describe('the store path', () => {
  it('is one document in the Harness home', () => {
    expect(oauthStorePath('/home/dsh')).toBe(join('/home/dsh', OAUTH_STORE_FILENAME))
  })
})

describe('the credential document', () => {
  it('keeps what it is given, lists it, and hands it back', async () => {
    const { store: credentials, path } = await store()
    await credentials.modify('openai-codex', async () => credential('a-token'))
    await credentials.modify('openrouter', async () => credential('b-token'))

    expect(await credentials.read('openai-codex')).toMatchObject({ access: 'a-token' })
    expect(await credentials.list()).toEqual([
      { providerId: 'openai-codex', type: 'oauth' },
      { providerId: 'openrouter', type: 'oauth' },
    ])
    expect(JSON.parse(await readFile(path, 'utf8'))).toHaveProperty('openrouter')
  })

  it('is readable only by its owner', async () => {
    const { store: credentials, path } = await store()
    await credentials.modify('xai', async () => credential('c-token'))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('shows the current credential to the change it is asked to make', async () => {
    const { store: credentials } = await store()
    await credentials.modify('kimi-coding', async () => credential('first'))
    const seen: (Credential | undefined)[] = []
    await credentials.modify('kimi-coding', async (current) => { seen.push(current); return credential('second') })

    expect(seen[0]).toMatchObject({ access: 'first' })
    expect(await credentials.read('kimi-coding')).toMatchObject({ access: 'second' })
  })

  it('leaves the entry alone when a change returns nothing, and drops it on a delete', async () => {
    const { store: credentials } = await store()
    await credentials.modify('radius', async () => credential('one'))

    expect(await credentials.modify('radius', async () => undefined)).toMatchObject({ access: 'one' })
    expect(await credentials.read('radius')).toMatchObject({ access: 'one' })
    expect(await credentials.modify('never-signed-in', async () => undefined)).toBeUndefined()

    await credentials.delete('radius')
    await credentials.modify('xai', async () => credential('two'))
    await credentials.delete('xai')
    expect(await credentials.list()).toEqual([])
    // Deleting what is not there leaves the document untouched.
    await credentials.delete('xai')
    expect(await credentials.list()).toEqual([])
  })

  it('keeps a sign-in when two requests meet an expiring token at once', async () => {
    const { store: credentials } = await store()
    await credentials.modify('expiring', async () => ({ type: 'oauth', access: 'old', refresh: 'r', expires: 1 }))
    let refreshes = 0
    const provider = {
      id: 'expiring',
      auth: {
        oauth: {
          name: 'Expiring',
          login: () => Promise.reject(new Error('not asked to sign in')),
          refresh: async (old: OAuthCredential): Promise<OAuthCredential> => {
            refreshes += 1
            return { ...old, access: 'new', expires: Date.now() + 3_600_000 }
          },
          toAuth: async (current: OAuthCredential) => ({ apiKey: current.access }),
        },
      },
      resolveModels: () => [],
    }
    const models = createModels({ credentials })
    models.setProvider(provider as never)

    // The chat's title and its first reply ask for the same token together, which is what wiped a live sign-in on 2 Nov.
    const answers = await Promise.all([models.getAuth('expiring'), models.getAuth('expiring')])

    expect(refreshes).toBe(1)
    expect(answers.map(answer => answer?.auth)).toEqual([{ apiKey: 'new' }, { apiKey: 'new' }])
    expect(await credentials.read('expiring')).toMatchObject({ access: 'new' })
  })

  it('keeps every provider when several change at once', async () => {
    const { store: credentials } = await store()
    const ids = ['one', 'two', 'three', 'four', 'five', 'six']
    await Promise.all(ids.map(id => credentials.modify(id, async () => credential(id))))
    expect((await credentials.list()).map(entry => entry.providerId).sort()).toEqual([...ids].sort())
  })

  it('serializes writes to one provider, so the last one wins', async () => {
    const { store: credentials } = await store()
    const writes = ['first', 'second', 'third'].map(token =>
      credentials.modify('openai-codex', async () => credential(token)))
    await Promise.all(writes)
    expect(await credentials.read('openai-codex')).toMatchObject({ access: 'third' })
  })

  it('carries on after a refused change, and reads a torn file as empty', async () => {
    const { store: credentials, path } = await store()
    await expect(credentials.modify('openrouter', () => Promise.reject(new Error('the flow was cancelled')))).rejects.toThrow('cancelled')
    await credentials.modify('openrouter', async () => credential('after'))
    expect(await credentials.read('openrouter')).toMatchObject({ access: 'after' })

    await writeFile(path, 'half a json document')
    expect(await credentials.list()).toEqual([])
    expect(await credentials.read('openrouter')).toBeUndefined()
  })
})
