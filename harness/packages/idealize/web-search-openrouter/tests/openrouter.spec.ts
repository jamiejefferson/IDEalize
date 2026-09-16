import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as plugin from '@idealize/web-search-openrouter'
import {
  OPENROUTER_PROVIDER_ID,
  OpenRouterSearchProvider,
  mapAnnotation,
  mapOpenRouterResponse,
  resolveOptions,
  searchPrompt,
} from '@idealize/web-search-openrouter'

const options = {
  apiKey: 'or-key',
  apiKeyEnv: credentialRef('OPENROUTER_API_KEY'),
  baseURL: 'https://openrouter.test/api/v1',
  model: 'deepseek/deepseek-v4-flash',
  maxResults: 5,
}

/** The options without a literal key, so the resolver decides. */
const { apiKey: _literal, ...keyless } = options

const CITED = {
  choices: [{
    message: {
      content: '  The answer.  ',
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A', content: ' excerpt ' } },
        { type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A again' } },
        { type: 'file', url_citation: { url: 'https://ignored.test' } },
        { type: 'url_citation', url_citation: null },
        { type: 'url_citation', url_citation: { url: '', title: 'no url' } },
        { type: 'url_citation', url_citation: { url: 'https://b.test', title: '', content: '   ' } },
      ],
    },
  }],
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('response mapping', () => {
  it('maps a citation and drops the rest', () => {
    expect(mapAnnotation({ type: 'url_citation', url_citation: { url: 'https://a.test', title: 'A', content: 'x' } }))
      .toEqual({ url: 'https://a.test', title: 'A', snippet: 'x' })
    expect(mapAnnotation({ type: 'url_citation', url_citation: { url: 'https://a.test', title: null, content: null } }))
      .toEqual({ url: 'https://a.test' })
    expect(mapAnnotation({ type: 'other' })).toBeUndefined()
    expect(mapAnnotation({ type: 'url_citation' })).toBeUndefined()
    expect(mapAnnotation({ type: 'url_citation', url_citation: { url: null } })).toBeUndefined()
  })

  it('takes the first choice, trims the answer and dedupes sources by URL', () => {
    expect(mapOpenRouterResponse(CITED)).toEqual({
      content: 'The answer.',
      sources: [{ url: 'https://a.test', title: 'A', snippet: 'excerpt' }, { url: 'https://b.test' }],
      truncated: false,
    })
  })

  it('answers empty when the response carries no choice, text or citations', () => {
    expect(mapOpenRouterResponse({})).toEqual({ sources: [], truncated: false })
    expect(mapOpenRouterResponse({ choices: null })).toEqual({ sources: [], truncated: false })
    expect(mapOpenRouterResponse({ choices: [{ message: null }] })).toEqual({ sources: [], truncated: false })
    expect(mapOpenRouterResponse({ choices: [{ message: { content: '  ', annotations: null } }] })).toEqual({ sources: [], truncated: false })
  })

  it('names the query in the prompt', () => {
    expect(searchPrompt('kerning in variable fonts')).toContain('Search the web for: kerning in variable fonts')
  })
})

describe('availability', () => {
  it('needs a key or a resolver, a parseable base URL and a positive page count', () => {
    expect(new OpenRouterSearchProvider(() => options).available()).toBe(true)
    expect(new OpenRouterSearchProvider(() => ({ ...options, apiKey: '' })).available()).toBe(false)
    expect(new OpenRouterSearchProvider(() => ({ ...keyless, resolveApiKey: async () => 'k' })).available()).toBe(true)
    expect(new OpenRouterSearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
    expect(new OpenRouterSearchProvider(() => ({ ...options, maxResults: 0 })).available()).toBe(false)
  })
})

describe('search', () => {
  it('posts the query with the web plugin and the request bound, and maps the answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CITED))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenRouterSearchProvider(() => options)
    await expect(provider.search({ query: 'q', maxResults: 3 })).resolves.toMatchObject({ content: 'The answer.' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.test/api/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer or-key', 'x-title': 'IDEalize' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: searchPrompt('q') }],
      plugins: [{ id: 'web', max_results: 3 }],
    })
  })

  it('falls back to the configured page count and resolves the key per search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CITED))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenRouterSearchProvider(() => ({ ...keyless, resolveApiKey: async () => 'stored' }))
    await provider.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer stored' })
    expect((JSON.parse(init.body as string) as { plugins: unknown }).plugins).toEqual([{ id: 'web', max_results: 5 }])
  })

  it('names the credential reference when nothing is stored, and reports a resolver failure', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const none = new OpenRouterSearchProvider(() => ({ ...keyless, resolveApiKey: async () => undefined }))
    await expect(none.search({ query: 'q' })).rejects.toThrow(/OPENROUTER_API_KEY/)
    await expect(none.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    const empty = new OpenRouterSearchProvider(() => ({ ...keyless, resolveApiKey: async () => '' }))
    await expect(empty.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    const bare = new OpenRouterSearchProvider(() => ({ ...keyless }))
    await expect(bare.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    const failing = new OpenRouterSearchProvider(() => ({ ...keyless, resolveApiKey: async () => { throw new Error('vault locked') } }))
    await expect(failing.search({ query: 'q' })).rejects.toThrow(/vault locked/)
    await expect(failing.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces the HTTP error message in either envelope, or the status alone', async () => {
    const provider = new OpenRouterSearchProvider(() => options)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'insufficient credits' } }, { status: 402 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'insufficient credits' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'rate limited' }, { status: 429 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ message: 'rate limited' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'plain message' }, { status: 500 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ message: 'plain message' }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: '' } }, { status: 503 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ message: 'OpenRouter error (HTTP 503)' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', { status: 502 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ message: 'OpenRouter error (HTTP 502)' }))
  })

  it('reports a network failure, an unprocessable body and a cancellation', async () => {
    const provider = new OpenRouterSearchProvider(() => options)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(/fetch failed/)
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(/unprocessable/)
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    const abort = (): never => { throw new DOMException('aborted', 'AbortError') }
    vi.stubGlobal('fetch', vi.fn(async () => abort()))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => abort() })))
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => abort() })))
    await expect(provider.search({ query: 'q' }, new AbortController().signal)).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('the plugin over ctx.web', () => {
  it('registers the provider (HMR-safe) and reads the key from the credential seam', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CITED))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    const resolve = vi.fn(async (ref: string) => ref === 'OPENROUTER_API_KEY' ? { value: 'from-store' } : undefined)
    ctx.provide('credentials', { resolve })
    const fiber = await ctx.plugin(plugin, {})
    await expect(ctx.web.search({ query: 'q', maxResults: 2 })).resolves.toMatchObject({ content: 'The answer.' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ authorization: 'Bearer from-store' })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('reads the launch environment when no credential seam is mounted, and a literal key wins over both', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'from-env')
    const fetchMock = vi.fn(async () => jsonResponse(CITED))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    await ctx.plugin(plugin, { apiKeyEnv: 'OPENROUTER_API_KEY', model: 'openai/gpt-4o-mini', maxResults: 2 })
    await ctx.web.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer from-env' })
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'openai/gpt-4o-mini', plugins: [{ id: 'web', max_results: 2 }] })

    const literal = new Context()
    await literal.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    await literal.plugin(plugin, { apiKey: 'literal' })
    await literal.web.search({ query: 'q' })
    const [, second] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(second.headers).toMatchObject({ authorization: 'Bearer literal' })
  })

  it('is unavailable to the seam only when it cannot resolve at all, and fails clearly when the environment has no key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn())
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    await ctx.plugin(plugin, {})
    await expect(ctx.web.search({ query: 'q' })).rejects.toThrow(/OPENROUTER_API_KEY/)
    await expect(ctx.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('treats an empty literal key as none, threads baseURL, and reports an empty credential store', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'from-env')
    const fetchMock = vi.fn(async () => jsonResponse(CITED))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    await ctx.plugin(plugin, { apiKey: '', baseURL: 'https://alt.test/v1' })
    await ctx.web.search({ query: 'q' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://alt.test/v1/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer from-env' })

    const empty = new Context()
    await empty.plugin(WebRuntime, { searchProvider: OPENROUTER_PROVIDER_ID })
    const resolve: (ref: string) => Promise<{ value: string } | undefined> = async () => undefined
    empty.provide('credentials', { resolve })
    await empty.plugin(plugin, {})
    await expect(empty.web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('fills every option from the package constants when the config names none', async () => {
    const ctx = new Context()
    const bare = resolveOptions(ctx, {})
    expect(bare).toMatchObject({ apiKeyEnv: 'OPENROUTER_API_KEY', baseURL: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash', maxResults: 5 })
    expect(bare.apiKey).toBeUndefined()
    await expect(bare.resolveApiKey?.()).resolves.toBeUndefined()
    const named = resolveOptions(ctx, { apiKey: 'k', apiKeyEnv: 'ALT_KEY', baseURL: 'https://alt.test', model: 'm', maxResults: 1 })
    expect(named).toMatchObject({ apiKey: 'k', apiKeyEnv: 'ALT_KEY', baseURL: 'https://alt.test', model: 'm', maxResults: 1 })
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in plugin).toBe(false)
  })
})
