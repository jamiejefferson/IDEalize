import { describe, expect, it, vi } from 'vitest'
import {
  importKeysFile,
  isKeysFilePath,
  KEYS_FILE_MAX_BYTES,
  keysFileFromArgv,
  keysFileNotification,
  confirmAndImportKeysFile,
} from '../src/keys-file.ts'
import type { KeysFileImport } from '../src/keys-file.ts'

const TEXT = JSON.stringify({ format: 1, credentials: { ANTHROPIC_API_KEY: 'sk-1', FAL_KEY: 'fal-1' } })

function stub(answer: { ok: boolean; status: number; body?: unknown; throws?: Error }, text = TEXT) {
  const requests: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = []
  const options: KeysFileImport = {
    path: '/Users/jj/Downloads/IDEalize Acme keys.idealizekeys',
    port: 3180,
    readFile: async () => text,
    request: async (url, init) => {
      requests.push({ url, init })
      if (answer.throws !== undefined) throw answer.throws
      return {
        ok: answer.ok,
        status: answer.status,
        json: async () => {
          if (answer.body === undefined) throw new SyntaxError('not JSON')
          return answer.body
        },
      }
    },
  }
  return { options, requests }
}

describe('recognising a keys file', () => {
  it('goes by the extension, in any case, and finds one among process arguments', () => {
    expect(isKeysFilePath('/Users/jj/keys.idealizekeys')).toBe(true)
    expect(isKeysFilePath('C:\\Users\\jj\\KEYS.IDEALIZEKEYS')).toBe(true)
    expect(isKeysFilePath('/Users/jj/keys.json')).toBe(false)
    expect(keysFileFromArgv(['/Applications/IDEalize.app/Contents/MacOS/IDEalize', '/tmp/a.idealizekeys'])).toBe('/tmp/a.idealizekeys')
    expect(keysFileFromArgv(['--user-data-dir=/tmp/scratch'])).toBeUndefined()
  })
})

describe('importing a keys file', () => {
  it('posts the document as read to the host, with the header, and names what connected', async () => {
    const { options, requests } = stub({
      ok: true, status: 200,
      body: { connected: [{ id: 'anthropic', kind: 'chat', name: 'Anthropic' }, { id: 'fal', kind: 'media', name: 'fal.ai' }], services: [] },
    })
    expect(await importKeysFile(options)).toEqual({ ok: true, connected: ['Anthropic', 'fal.ai'] })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('http://127.0.0.1:3180/idealize/brains/services/import')
    expect(requests[0]!.init.method).toBe('POST')
    expect(requests[0]!.init.headers['x-idealize-auth']).toBe('1')
    expect(requests[0]!.init.body).toBe(TEXT)
  })

  it('carries the host’s reason for a refusal, and the status when there is none', async () => {
    expect(await importKeysFile(stub({ ok: false, status: 400, body: { error: 'NOBODY_API_KEY is not a credential any service this app can connect takes' } }).options))
      .toEqual({ ok: false, reason: 'NOBODY_API_KEY is not a credential any service this app can connect takes' })
    expect(await importKeysFile(stub({ ok: false, status: 403 }).options))
      .toEqual({ ok: false, reason: 'the app answered 403' })
  })

  it('refuses a file larger than a keys file without sending it', async () => {
    const { options, requests } = stub({ ok: true, status: 200, body: {} }, 'x'.repeat(KEYS_FILE_MAX_BYTES + 1))
    expect(await importKeysFile(options)).toEqual({ ok: false, reason: 'the file is larger than a keys file (65536 bytes at most)' })
    expect(requests).toHaveLength(0)
  })

  it('reports a file it could not read and a host it could not reach', async () => {
    const unreadable = stub({ ok: true, status: 200, body: {} }).options
    unreadable.readFile = async () => { throw new Error('ENOENT') }
    expect(await importKeysFile(unreadable)).toEqual({ ok: false, reason: 'could not read the file: ENOENT' })
    expect(await importKeysFile(stub({ ok: true, status: 200, throws: new Error('ECONNREFUSED') }).options))
      .toEqual({ ok: false, reason: 'the app could not be reached: ECONNREFUSED' })
  })

  it('reads an answer that names nothing as nothing connected', async () => {
    expect(await importKeysFile(stub({ ok: true, status: 200, body: { services: [] } }).options)).toEqual({ ok: true, connected: [] })
  })
})

describe('the notification', () => {
  it('names the services, or says the file named none, or carries the reason', () => {
    expect(keysFileNotification({ ok: true, connected: ['Anthropic', 'fal.ai'] }))
      .toEqual({ title: 'Keys connected', body: 'Anthropic, fal.ai ready to use. Open Brains to check.' })
    expect(keysFileNotification({ ok: true, connected: [] }))
      .toEqual({ title: 'Keys file read', body: 'It named no service this app connects.' })
    expect(keysFileNotification({ ok: false, reason: 'the app answered 403' }))
      .toEqual({ title: 'Keys file not applied', body: 'the app answered 403' })
  })
})

describe('confirming a keys file', () => {
  const FILE = JSON.stringify({ format: 1, credentials: { OPENROUTER_API_KEY: 'sk-or-secret', FAL_KEY: 'fal-secret', ODD_API_KEY: 'odd-secret' } })
  const SERVICES = [
    { id: 'openrouter', name: 'OpenRouter', connected: true },
    { id: 'fal', name: 'fal', connected: false },
  ]

  function harness(answer: boolean, readFile: () => Promise<string> = async () => FILE) {
    const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ connected: [{ name: 'OpenRouter' }] }) }))
    const ask = vi.fn(async () => answer)
    return { request, ask, options: { path: '/tmp/Acme keys.idealizekeys', port: 1234, readFile, request, ask, listServices: async () => SERVICES } }
  }

  it('a double-clicked file changes nothing until the person says yes', async () => {
    const { options, request, ask } = harness(false)
    await expect(confirmAndImportKeysFile(options)).resolves.toBeUndefined()
    expect(ask).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it('shows where a gateway in the file would send the work, and which gateway it replaces', async () => {
    const file = JSON.stringify({ format: 1, credentials: { GATEWAY_URL: 'https://gateway.test', GATEWAY_API_KEY: 'gw-secret', FAL_KEY: 'fal-secret' } })
    const { options, ask } = harness(false, async () => file)
    await confirmAndImportKeysFile({ ...options, currentGateway: async () => 'https://old.test' })
    const question = (ask.mock.calls as unknown as [{ detail: string }][])[0]?.[0]
    expect(question?.detail).toContain('Key gateway at gateway.test (https://gateway.test)')
    expect(question?.detail).toContain('its replies direct what your agents do on this Mac')
    expect(question?.detail).toContain('This replaces the gateway you have connected now, at old.test.')
    expect(question?.detail).toContain('fal: adds a new key')
    expect(question?.detail).not.toContain('GATEWAY_URL')
    expect(question?.detail).not.toContain('gw-secret')
  })

  it('names each service, says which key it replaces and never shows a key', async () => {
    const { options, ask } = harness(false)
    await confirmAndImportKeysFile(options)
    const question = (ask.mock.calls as unknown as [{ message: string; detail: string; confirm: string }][])[0]?.[0]
    expect(question?.message).toContain('Acme keys.idealizekeys')
    expect(question?.detail).toContain('OpenRouter: replaces the key you have now')
    expect(question?.detail).toContain('fal: adds a new key')
    expect(question?.detail).toContain('ODD_API_KEY: replaces any key you have for it')
    expect(question?.confirm).toBe('Add Keys')
    expect(JSON.stringify(question)).not.toContain('secret')
  })

  it('on yes, posts the text the person was shown, even if the file has changed since', async () => {
    let reads = 0
    const { options, request } = harness(true, async () => {
      reads += 1
      return reads === 1 ? FILE : JSON.stringify({ format: 1, credentials: { OTHER_API_KEY: 'swapped' } })
    })
    await expect(confirmAndImportKeysFile(options)).resolves.toEqual({ ok: true, connected: ['OpenRouter'] })
    expect(reads).toBe(1)
    expect((request.mock.calls as unknown as [string, { body: string }][])[0]?.[1].body).toBe(FILE)
  })

  it('still asks when the service list is unavailable', async () => {
    const { options, ask } = harness(false)
    await confirmAndImportKeysFile({ ...options, listServices: async () => undefined })
    const question = (ask.mock.calls as unknown as [{ detail: string }][])[0]?.[0]
    expect(question?.detail).toContain('OPENROUTER_API_KEY: replaces any key you have for it')
  })

  it('lets the route refuse text that is no keys file, asking nothing', async () => {
    const request = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid JSON' }) }))
    const ask = vi.fn(async () => true)
    await expect(confirmAndImportKeysFile({
      path: '/tmp/x.idealizekeys', port: 1, readFile: async () => 'not json', request, ask,
    })).resolves.toEqual({ ok: false, reason: 'invalid JSON' })
    expect(ask).not.toHaveBeenCalled()
  })
})
