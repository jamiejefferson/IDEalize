/**
 * One-tap connect for a key gateway: the link, the question, the code
 * exchange, and the keys-file import it ends in.
 */
import { describe, expect, it, vi } from 'vitest'
import { connectGatewayLink, gatewayLinkNotification } from '../src/gateway-link.ts'
import { parseIdealizeUrl, requestFromArgv } from '../src/idealize-url.ts'
import { gatewayLinkQuestion } from '../src/open-confirmation.ts'

const LINK = 'idealize://gateway?address=https%3A%2F%2Fgateway.test%2F&code=abc123'

describe('a gateway link', () => {
  it('reads the address and the code', () => {
    expect(parseIdealizeUrl(LINK)).toEqual({ kind: 'connect-gateway', address: 'https://gateway.test', code: 'abc123' })
    expect(requestFromArgv(['/Applications/IDEalize V1.app/Contents/MacOS/IDEalize', LINK])).toMatchObject({ kind: 'connect-gateway' })
  })

  it('refuses an address that is not plain https, and a code that is missing, too long or not printable', () => {
    const link = (address: string, code = 'abc') => `idealize://gateway?address=${encodeURIComponent(address)}&code=${encodeURIComponent(code)}`
    expect(parseIdealizeUrl(link('http://gateway.test'))).toBeUndefined()
    expect(parseIdealizeUrl(link('http://127.0.0.1:8787'))).toMatchObject({ address: 'http://127.0.0.1:8787' })
    expect(parseIdealizeUrl(link('https://me:pw@gateway.test'))).toBeUndefined()
    expect(parseIdealizeUrl(link('https://gateway.test/?next=evil'))).toBeUndefined()
    expect(parseIdealizeUrl(link('not an address'))).toBeUndefined()
    expect(parseIdealizeUrl(link('https://gateway.test', ''))).toBeUndefined()
    expect(parseIdealizeUrl(link('https://gateway.test', 'x'.repeat(101)))).toBeUndefined()
    expect(parseIdealizeUrl(link('https://gateway.test', 'a b'))).toBeUndefined()
    expect(parseIdealizeUrl(link('https://gateway.test', 'x'.repeat(100)))).toMatchObject({ code: 'x'.repeat(100) })
  })

  it('asks by the gateway\'s host and says the gateway will see the work', () => {
    const question = gatewayLinkQuestion('https://gateway.test')
    expect(question.message).toBe('A link is asking IDEalize to connect the key gateway at gateway.test.')
    expect(question.detail).toContain('it will see them')
    expect(question.confirm).toBe('Connect')
  })
})

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

function connect(options: { answer?: boolean; pair?: () => Promise<ReturnType<typeof json>>; host?: ReturnType<typeof json> } = {}) {
  const asked: string[] = []
  const pairCalls: { url: string; body: string }[] = []
  const hostCalls: { url: string; body?: string; headers: Record<string, string> }[] = []
  const outcome = connectGatewayLink({
    link: { kind: 'connect-gateway', address: 'https://gateway.test', code: 'abc123' },
    ask: async (question) => { asked.push(question.message); return options.answer ?? true },
    port: 4321,
    launchKey: 'launch',
    fetchGateway: async (url, init) => {
      pairCalls.push({ url, body: init.body })
      return await (options.pair ?? (async () => json(200, { address: 'https://elsewhere.test', key: 'kb-secret', me_url: 'https://gateway.test/v1/me' })))()
    },
    request: vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      hostCalls.push({ url, headers: init.headers, ...init.body === undefined ? {} : { body: init.body } })
      return options.host ?? json(200, { connected: [{ name: 'Key gateway' }] })
    }),
  })
  return { outcome, asked, pairCalls, hostCalls }
}

describe('connecting from a gateway link', () => {
  it('asks, claims the code, and stores the agreed address with the key through the keys-file import', async () => {
    const run = connect()
    expect(await run.outcome).toEqual({ ok: true, connected: ['Key gateway'] })
    expect(run.asked).toHaveLength(1)
    expect(run.pairCalls).toEqual([{ url: 'https://gateway.test/v1/pair', body: '{"code":"abc123"}' }])
    expect(run.hostCalls[0]?.url).toBe('http://127.0.0.1:4321/idealize/brains/services/import')
    expect(run.hostCalls[0]?.headers['x-idealize-key']).toBe('launch')
    expect(JSON.parse(run.hostCalls[0]?.body ?? '')).toEqual({
      format: 1, credentials: { GATEWAY_URL: 'https://gateway.test', GATEWAY_API_KEY: 'kb-secret' },
    })
  })

  it('does nothing at all when the person cancels', async () => {
    const run = connect({ answer: false })
    expect(await run.outcome).toBeUndefined()
    expect(run.pairCalls).toHaveLength(0)
    expect(run.hostCalls).toHaveLength(0)
  })

  it('shows the gateway\'s own words for a used code, and stores nothing', async () => {
    const run = connect({ pair: async () => json(404, { error: 'This code has been used or has expired. Press Connect again.' }) })
    expect(await run.outcome).toEqual({ ok: false, reason: 'This code has been used or has expired. Press Connect again.' })
    expect(run.hostCalls).toHaveLength(0)
  })

  it('says so when the gateway does not answer or sends no key', async () => {
    expect(await connect({ pair: async () => { throw new TypeError('fetch failed') } }).outcome)
      .toEqual({ ok: false, reason: 'The gateway did not answer. Press Connect in the gateway again.' })
    expect(await connect({ pair: async () => json(200, {}) }).outcome)
      .toEqual({ ok: false, reason: 'The gateway sent no key. Press Connect in the gateway again.' })
  })

  it('passes on the app\'s refusal when the gateway refuses the key it just gave', async () => {
    const run = connect({ host: json(401, { error: 'Key gateway: Key revoked.' }) })
    expect(await run.outcome).toEqual({ ok: false, reason: 'Key gateway: Key revoked.' })
  })

  it('names the gateway by host in the notification', () => {
    expect(gatewayLinkNotification('https://gateway.test', { ok: true, connected: ['Key gateway'] }))
      .toEqual({ title: 'Key gateway connected', body: 'gateway.test is connected. Open Brains to see what it reaches.' })
    expect(gatewayLinkNotification('https://gateway.test', { ok: false, reason: 'No.' }).title).toBe('Key gateway not connected')
  })
})
