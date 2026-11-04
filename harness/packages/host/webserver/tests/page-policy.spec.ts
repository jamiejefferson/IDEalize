/**
 * The app's own pages carry a content security policy, so a rendering bug that
 * lets hostile text into a page cannot run script, load script from elsewhere, or
 * send anything off the machine. The browser half of the proof is a replay
 * against a real page; this holds what the server sends.
 */

import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HttpServer from '../src/index.ts'
import { appPagePolicy, ROUTE_PAGE_POLICY } from '../src/page-policy.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const directive = (policy: string, name: string): string[] => {
  const found = policy.split(';').map(part => part.trim().split(/\s+/u)).find(([head]) => head === name)
  return found?.slice(1) ?? []
}

const sha = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

describe('the app page policy', () => {
  it('allows exactly the inline scripts the page was built with', () => {
    const page = '<head><script>first()</script><script type="module" src="/a.js"></script><script>\nsecond()\n</script></head>'
    const scripts = directive(appPagePolicy(page), 'script-src')
    expect(scripts).toContain(sha('first()'))
    expect(scripts).toContain(sha('\nsecond()\n'))
    expect(scripts).not.toContain('\'unsafe-inline\'')
    expect(scripts.filter(source => source.startsWith('\'sha256-'))).toHaveLength(2)
  })

  it('never allows script from another server', () => {
    for (const policy of [appPagePolicy('<head></head>'), ROUTE_PAGE_POLICY]) {
      const scripts = directive(policy, 'script-src')
      expect(scripts.some(source => /^https?:/u.test(source) || source === '*')).toBe(false)
    }
  })

  it('closes the ways out', () => {
    for (const policy of [appPagePolicy('<head></head>'), ROUTE_PAGE_POLICY]) {
      expect(directive(policy, 'default-src')).toEqual(['\'self\''])
      expect(directive(policy, 'connect-src')).toEqual(['\'self\'', 'data:', 'blob:'])
      expect(directive(policy, 'frame-src')).toEqual(['\'self\''])
      expect(directive(policy, 'object-src')).toEqual(['\'none\''])
      expect(directive(policy, 'base-uri')).toEqual(['\'none\''])
      expect(directive(policy, 'form-action')).toEqual(['\'self\''])
      expect(directive(policy, 'frame-ancestors')).toEqual(['\'self\''])
    }
  })

  it('lets an image load from either kind of address once someone clicks for it', () => {
    expect(directive(ROUTE_PAGE_POLICY, 'img-src')).toEqual(expect.arrayContaining(['https:', 'http:']))
  })
})

describe('the server', () => {
  async function serve(): Promise<{ server: HttpServer; port: number }> {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
    const server = (ctx as unknown as { webServer: HttpServer }).webServer
    return { server, port: server.port }
  }

  const get = async (port: number, path: string): Promise<{ policy: string | undefined; body: string }> =>
    await new Promise((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => { resolve({ policy: res.headers['content-security-policy'] as string | undefined, body: Buffer.concat(chunks).toString() }) })
      }).on('error', reject).end()
    })

  it('sends a policy naming the served page\'s own scripts, after every tap has run', async () => {
    const { server, port } = await serve()
    server.tapIndex(html => html.replace('<head>', '<head><script>tapped()</script>'))
    server.registerFallback((_req, res) => {
      const page = server.applyIndexTaps('<head><script>built()</script></head>')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(page)
    })
    const page = await get(port, '/')
    expect(page.body).toContain('tapped()')
    const scripts = directive(page.policy ?? '', 'script-src')
    expect(scripts).toContain(sha('tapped()'))
    expect(scripts).toContain(sha('built()'))
    expect(scripts).not.toContain('\'unsafe-inline\'')
  })

  it('still serves a page whose headers went out before its taps ran', async () => {
    const { server, port } = await serve()
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(server.applyIndexTaps('<head></head><body>shell</body>'))
    })
    expect((await get(port, '/')).body).toContain('shell')
  })

  it('gives a route the route policy, and a route\'s own policy replaces it', async () => {
    const { server, port } = await serve()
    server.register({ kind: 'exact', path: '/plain', handler: (_req, res) => { res.writeHead(200).end('ok') } })
    server.register({
      kind: 'exact',
      path: '/own',
      handler: (_req, res) => { res.writeHead(200, { 'content-security-policy': 'default-src \'none\'' }).end('ok') },
    })
    expect((await get(port, '/plain')).policy).toBe(ROUTE_PAGE_POLICY)
    expect((await get(port, '/own')).policy).toBe('default-src \'none\'')
  })
})
