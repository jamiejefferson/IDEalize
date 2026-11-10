// @vitest-environment jsdom
// The key gateway's Brains row: it asks for an address and a key, shows the
// gateway's own refusal, and once connected shows what the key reaches and
// this month's spend.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { GatewayRow, gatewayLine } from '../src/client/GatewayRow.tsx'

const t = makeTranslate(en, commonEn) as Parameters<typeof GatewayRow>[0]['t']

const response = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as Response

afterEach(cleanup)

describe('the gateway row', () => {
  it('says what the key reaches and what it has spent', () => {
    expect(gatewayLine({ configured: true, connected: true, preset: 'Designer', services: ['Claude', 'fal'], spentGbp: 3.5, budgetGbp: 50 }, t))
      .toBe('Designer · Reaches Claude, fal · £3.50 of £50.00 spent this month')
    expect(gatewayLine({ configured: true, connected: false, services: [], error: 'Key revoked.' }, t)).toBe('Key revoked.')
    expect(gatewayLine({ configured: false, connected: false, services: [] }, t)).toBe('One key from your organisation for every model')
  })

  it('connects with an address and a key, and shows the gateway\'s refusal', async () => {
    const posts: unknown[] = []
    let refuse = true
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(init.body as string))
        return Promise.resolve(refuse
          ? response(401, { error: 'Key revoked.' })
          : response(200, { configured: true, connected: true, preset: 'Designer', services: ['Claude'] }))
      }
      return Promise.resolve(response(200, { configured: false, connected: false, services: [] }))
    })
    const view = render(<GatewayRow t={t} configuredOnly={false} fetchImpl={fetchImpl as never} />)
    fireEvent.click(await view.findByText('Connect'))
    fireEvent.change(view.getByLabelText('Gateway address'), { target: { value: 'https://gateway.test' } })
    fireEvent.change(view.getByLabelText('Gateway key'), { target: { value: 'kb-x' } })
    fireEvent.click(view.container.querySelector('[data-gateway-connect]') as Element)
    expect((await view.findByRole('alert')).textContent).toBe('Key revoked.')
    refuse = false
    fireEvent.click(view.container.querySelector('[data-gateway-connect]') as Element)
    // Connected, it leaves the full list for the connected services above it.
    await waitFor(() => { expect(view.container.querySelector('[data-gateway]')).toBeNull() })
    expect(posts).toEqual([{ address: 'https://gateway.test', key: 'kb-x' }, { address: 'https://gateway.test', key: 'kb-x' }])
  })

  it('keeps to its list: a set gateway shows with the connected services, an unset one in the full list', async () => {
    const set = vi.fn(() => Promise.resolve(response(200, { configured: true, connected: true, services: [] })))
    const hidden = render(<GatewayRow t={t} configuredOnly={false} fetchImpl={set as never} />)
    await waitFor(() => { expect(set).toHaveBeenCalled() })
    expect(hidden.container.querySelector('[data-gateway]')).toBeNull()
    cleanup()
    const shown = render(<GatewayRow t={t} configuredOnly fetchImpl={set as never} />)
    await waitFor(() => { expect(shown.container.querySelector('[data-gateway]')).not.toBeNull() })
  })
})
