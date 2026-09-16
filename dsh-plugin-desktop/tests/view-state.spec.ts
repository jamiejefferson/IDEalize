import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  desktopViewStatePath,
  handleDesktopViewStateRequest,
  parseDesktopViewState,
  readDesktopViewState,
  writeDesktopViewState,
  type DesktopViewState,
} from '../src/view-state.ts'

const ORIGIN = 'http://127.0.0.1:43120'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-view-state-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function postRequest(body: unknown, headers: Record<string, string | undefined> = {}): IncomingMessage {
  return {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...headers,
    },
    async * [Symbol.asyncIterator]() { yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) },
  } as unknown as IncomingMessage
}

function response(): { res: ServerResponse; body(): string } {
  let body = ''
  const res = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => { body = value ?? '' }),
  } as unknown as ServerResponse
  return { res, body: () => body }
}

describe('desktop view state persistence', () => {
  it('derives the state file below the user-data directory', () => {
    expect(desktopViewStatePath('/data')).toBe(join('/data', 'view-state', 'view-state.json'))
  })

  it('round-trips a recorded session id', () => {
    const path = join(tempDir(), 'view-state', 'view-state.json')
    expect(readDesktopViewState(path)).toBeUndefined()
    writeDesktopViewState(path, { sessionId: 'session-9' })
    expect(readDesktopViewState(path)).toEqual({ sessionId: 'session-9' })
  })

  it('reads corrupted or foreign content as no stored state', () => {
    const dir = tempDir()
    const path = join(dir, 'view-state.json')
    writeFileSync(path, 'not json', 'utf8')
    expect(readDesktopViewState(path)).toBeUndefined()
    writeFileSync(path, JSON.stringify({ sessionId: 42 }), 'utf8')
    expect(readDesktopViewState(path)).toBeUndefined()
  })

  it('validates untrusted values', () => {
    expect(parseDesktopViewState({ sessionId: 'ok' })).toEqual({ sessionId: 'ok' })
    expect(parseDesktopViewState({ sessionId: '' })).toBeUndefined()
    expect(parseDesktopViewState({ sessionId: 'x'.repeat(257) })).toBeUndefined()
    expect(parseDesktopViewState(['sessionId'])).toBeUndefined()
    expect(parseDesktopViewState(null)).toBeUndefined()
  })
})

describe('desktop view state route', () => {
  it('serves the stored state (or an empty object) on GET', async () => {
    const stored: DesktopViewState = { sessionId: 'session-3' }
    let state: DesktopViewState | undefined
    const store = { read: () => state, write: (next: DesktopViewState) => { state = next } }
    const first = response()
    await handleDesktopViewStateRequest({ method: 'GET', headers: {} } as IncomingMessage, first.res, ORIGIN, store)
    expect(first.res.statusCode).toBe(200)
    expect(JSON.parse(first.body())).toEqual({})

    state = stored
    const second = response()
    await handleDesktopViewStateRequest({ method: 'GET', headers: {} } as IncomingMessage, second.res, ORIGIN, store)
    expect(JSON.parse(second.body())).toEqual(stored)
  })

  it('records a same-origin POST', async () => {
    const write = vi.fn()
    const { res } = response()
    await handleDesktopViewStateRequest(postRequest({ sessionId: 'session-5' }), res, ORIGIN, { read: () => undefined, write })
    expect(res.statusCode).toBe(204)
    expect(write).toHaveBeenCalledWith({ sessionId: 'session-5' })
  })

  it('refuses foreign origins, foreign methods, foreign content types, and invalid bodies', async () => {
    const write = vi.fn()
    const store = { read: () => undefined, write }

    const foreignOrigin = response()
    await handleDesktopViewStateRequest(postRequest({ sessionId: 's' }, { origin: 'http://evil.example' }), foreignOrigin.res, ORIGIN, store)
    expect(foreignOrigin.res.statusCode).toBe(403)

    const foreignMethod = response()
    await handleDesktopViewStateRequest({ method: 'DELETE', headers: {} } as IncomingMessage, foreignMethod.res, ORIGIN, store)
    expect(foreignMethod.res.statusCode).toBe(405)

    const foreignType = response()
    await handleDesktopViewStateRequest(postRequest({ sessionId: 's' }, { 'content-type': 'text/plain' }), foreignType.res, ORIGIN, store)
    expect(foreignType.res.statusCode).toBe(415)

    const invalidBody = response()
    await handleDesktopViewStateRequest(postRequest('not json'), invalidBody.res, ORIGIN, store)
    expect(invalidBody.res.statusCode).toBe(400)

    expect(write).not.toHaveBeenCalled()
  })
})
