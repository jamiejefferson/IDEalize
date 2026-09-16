/**
 * The credential document: one JSON file at mode 0600, per-provider writes
 * that serialize, and an unreadable file that reads as no credentials rather
 * than failing the caller.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Credential } from '@earendil-works/pi-ai'
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

  it('drops the entry when a change returns nothing, and on a delete', async () => {
    const { store: credentials } = await store()
    await credentials.modify('radius', async () => credential('one'))
    await credentials.modify('xai', async () => credential('two'))

    expect(await credentials.modify('radius', async () => undefined)).toBeUndefined()
    expect(await credentials.read('radius')).toBeUndefined()

    await credentials.delete('xai')
    expect(await credentials.list()).toEqual([])
    // Deleting what is not there leaves the document untouched.
    await credentials.delete('xai')
    expect(await credentials.list()).toEqual([])
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
