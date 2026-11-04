/**
 * Stored keys go only to encrypted addresses or this computer, and a request
 * with no answer ends only when the provider's server cannot be reached.
 */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { exposesKey, isLoopbackAddress, isReachable } from '../src/address.ts'
import { resolveProfiles } from '../src/config.ts'
import { discoverModels } from '../src/discovery.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const MODEL = 'deepseek-v4-flash'

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await closeMockServers()
  await closeStalled()
})

const stalled: Server[] = []
async function closeStalled(): Promise<void> {
  await Promise.all(stalled.splice(0).map(server => new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  })))
}

/** A server that takes the request and says nothing, then optionally answers. */
async function silentServer(answerAfterMs?: number): Promise<{ url: string }> {
  const server = createServer((_request, response) => {
    if (answerAfterMs === undefined) return
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of textEvents) response.write(`data: ${event}\n\n`)
      response.end()
    }, answerAfterMs)
  })
  stalled.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}` }
}

function adapter(baseURL: string, check?: { everyMs: number; reachable: (url: string) => Promise<boolean> }): PiAiAdapter {
  const profiles = resolveProfiles({
    deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL },
  })
  return new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => Promise.resolve('test-key'),
    ...check === undefined ? {} : { firstByteCheck: check },
  })
}

async function run(chunks: AsyncIterable<StreamChunk>): Promise<{ text: string }> {
  const assembler = new BlockAssembler()
  for await (const chunk of chunks) assembler.push(chunk)
  return { text: assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('') }
}

const ask = (a: PiAiAdapter) => run(a.stream({
  provider: 'deepseek',
  model: MODEL,
  messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })],
}))

describe('what counts as this computer', () => {
  it.each([
    'http://localhost:11434/v1', // Ollama
    'http://127.0.0.1:1234/v1', // LM Studio
    'http://0.0.0.0:1234/v1',
    'http://[::1]:11434/v1',
    'http://127.1:8080', // the URL parser spells this 127.0.0.1
  ])('%s is local, and a key may go to it', (url) => {
    expect(isLoopbackAddress(url)).toBe(true)
    expect(exposesKey(url)).toBe(false)
  })

  it.each([
    'http://192.168.1.20:11434/v1',
    'http://api.example.com/v1',
    'http://localhost.example.com/v1',
    'http://127.0.0.1.example.com/v1',
    'http://[::ffff:8.8.8.8]/v1',
    'ws://api.example.com/v1',
  ])('%s is outside this computer and unencrypted', (url) => {
    expect(isLoopbackAddress(url)).toBe(false)
    expect(exposesKey(url)).toBe(true)
  })

  it.each(['https://api.example.com/v1', 'wss://api.example.com/v1', ''])('%j does not expose a key', (url) => {
    expect(exposesKey(url)).toBe(false)
  })
})

describe('sending a stored key', () => {
  it('refuses an unencrypted outside address, naming it in plain words, before any request', async () => {
    // The replay: a settings file edited to point a stored key at another
    // server. Nothing is listening at this address, and nothing needs to be:
    // the refusal comes first.
    const fetched = vi.spyOn(globalThis, 'fetch')
    const error = await ask(adapter('http://key-thief.example.com/v1')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).failure.code).toBe('INSECURE_ADDRESS')
    expect((error as LlmError).message).toMatch(/not a secure address/)
    expect(fetched).not.toHaveBeenCalled()
    fetched.mockRestore()
  })

  it('sends to a local model server over plain http', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { text } = await ask(adapter(server.url))
    expect(text).toBe('hello')
    expect(server.headers[0]?.authorization).toBe('Bearer test-key')
  })

  it('leaves a keyless server on the local network working', async () => {
    // A custom route that names no key: nothing to expose.
    const profiles = resolveProfiles({
      'lan-box': {
        api: 'openai-completions',
        baseURL: 'http://192.168.1.20:11434/v1',
        models: [{ id: 'llama' }],
      },
    })
    const fetched = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const a = new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve(undefined) })
    const outcome = await run(a.stream({
      provider: 'lan-box',
      model: 'llama',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })],
    })).catch((caught: unknown) => caught)
    // It tried the network, and did not stop at the address.
    expect((outcome as Error | undefined)?.message ?? '').not.toMatch(/not a secure address/)
    fetched.mockRestore()
  })

  it('refuses to test a typed or stored key against an unencrypted address', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch')
    await expect(discoverModels({ baseURL: 'http://key-thief.example.com/v1', apiKey: 'sk-typed' }))
      .rejects.toThrow(/not a secure address/)
    await expect(discoverModels({ baseURL: 'http://key-thief.example.com/v1' }, () => Promise.resolve('sk-stored')))
      .rejects.toThrow(/not a secure address/)
    expect(fetched).not.toHaveBeenCalled()
    fetched.mockRestore()
  })

  it('goes through the composed plugin too', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: 'http://key-thief.example.com/v1' } } })
    const { finish } = await assemble(ctx, { model: MODEL, messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })] })
    expect(finish).toMatchObject({ kind: 'error', failure: { code: 'INSECURE_ADDRESS' } })
  })
})

describe('a request with no answer', () => {
  /** Stands in for the network behind an outside address. @returns the requests it saw. */
  function network(answer: (signal: AbortSignal) => Promise<Response>): void {
    vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => answer(init.signal as AbortSignal))
  }
  /** Never answers, and goes when the request is abandoned, as a dead connection does. */
  const silence = (signal: AbortSignal): Promise<Response> => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
  })
  const sse = (...parts: { after: number; text: string }[]): Response => new Response(new ReadableStream({
    async start(controller) {
      for (const part of parts) {
        await new Promise(resolve => setTimeout(resolve, part.after))
        controller.enqueue(new TextEncoder().encode(part.text))
      }
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  const answer = textEvents.map(event => `data: ${event}\n\n`).join('')
  const OUTSIDE = 'https://slow-model.example.com/v1'

  it('ends early when the server cannot be reached, and says so plainly', async () => {
    // The replay: the network drops after the request goes out, so nothing
    // tells the connection it is dead.
    network(silence)
    const error = await ask(adapter(OUTSIDE, { everyMs: 50, reachable: () => Promise.resolve(false) })).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).failure.code).toBe('TIMEOUT')
    expect((error as LlmError).message).toMatch(/can't be reached/)
  })

  it('keeps waiting for a slow model whose server is reachable, past many checks', async () => {
    // A server that holds its response back until the first token, then answers.
    network(async () => {
      await new Promise(resolve => setTimeout(resolve, 400))
      return sse({ after: 0, text: answer })
    })
    const reachable = vi.fn(() => Promise.resolve(true))
    const { text } = await ask(adapter(OUTSIDE, { everyMs: 50, reachable }))
    expect(text).toBe('hello')
    expect(reachable.mock.calls.length).toBeGreaterThan(3)
  })

  it('stops checking once the response starts, even with only keep-alive lines and no token yet', async () => {
    // Long thinking behind a gateway: the response starts at once, keep-alive
    // comment lines follow, and the first token comes much later. A check that
    // counted tokens would have cut this off.
    network(() => Promise.resolve(sse(
      { after: 0, text: ': OPENROUTER PROCESSING\n\n' },
      { after: 200, text: ': OPENROUTER PROCESSING\n\n' },
      { after: 200, text: answer },
    )))
    const reachable = vi.fn(() => Promise.resolve(false))
    const { text } = await ask(adapter(OUTSIDE, { everyMs: 100, reachable }))
    expect(text).toBe('hello')
    expect(reachable).not.toHaveBeenCalled()
  })

  it('never checks a model on this computer: it may take minutes to load', async () => {
    const server = await silentServer(300)
    const reachable = vi.fn(() => Promise.resolve(false))
    const { text } = await ask(adapter(server.url, { everyMs: 20, reachable }))
    expect(text).toBe('hello')
    expect(reachable).not.toHaveBeenCalled()
  })

  it('tells a server that answers from one that does not', async () => {
    const up = await mockServer([{ status: 404, body: 'nope' }])
    await expect(isReachable(up.url)).resolves.toBe(true)
    await expect(isReachable('http://127.0.0.1:1', 500)).resolves.toBe(false)
  })
})
