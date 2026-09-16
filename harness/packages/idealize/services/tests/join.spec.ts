/**
 * The Services list is one list, ordered so what the person already has reads
 * first, and it never invents a key page it does not know.
 */

import { describe, expect, it } from 'vitest'
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { joinServices, keyPageFor, serviceName } from '../src/join.ts'
import { orderMakes, orderServices } from '../src/directory.ts'
import { chatKeyEnv } from '../src/routes.ts'

const chatRow = (provider: string, displayName: string, connected = false) =>
  ({ provider, displayName, connected })

const mediaRow = (
  backend: string,
  displayName: string,
  artefacts: readonly ('image' | 'video' | 'audio')[],
  connected = false,
) => ({ backend, displayName, env: `${backend.toUpperCase()}_KEY`, connected, artefacts })

describe('the services list', () => {
  it('carries chat routes and generation backends as rows of one list', () => {
    const rows = joinServices(
      [chatRow('anthropic', 'Anthropic')],
      [mediaRow('fal', 'fal.ai', ['image', 'video', 'audio'])],
    )
    expect(rows.map(row => [row.name, row.kind, row.makes.join('/')])).toEqual([
      ['Anthropic', 'chat', 'chat'],
      ['fal.ai', 'media', 'image/video/audio'],
    ])
  })

  it('puts connected services first so the person sees what they already have', () => {
    const rows = joinServices(
      [chatRow('zeta', 'Zeta'), chatRow('alpha', 'Alpha')],
      [mediaRow('fal', 'fal.ai', ['image'], true)],
    )
    expect(rows.map(row => row.name)).toEqual(['fal.ai', 'Alpha', 'Zeta'])
  })

  it('describes what a backend makes from its live catalogue, in a fixed order', () => {
    const [row] = joinServices([], [mediaRow('m', 'Maker', ['audio', 'image'])])
    expect(row?.makes).toEqual(['image', 'audio'])
  })

  it('reports a backend whose catalogue is empty as making nothing rather than guessing', () => {
    const [row] = joinServices([], [mediaRow('m', 'Maker', [])])
    expect(row?.makes).toEqual([])
  })

  it('keeps a company selling both as two rows, because either key can stand alone', () => {
    const rows = joinServices(
      [chatRow('openrouter', 'OpenRouter', true)],
      [mediaRow('openrouter', 'OpenRouter', ['image'])],
    )
    expect(rows.map(row => [row.kind, row.connected])).toEqual([['chat', true], ['media', false]])
  })

  it('offers a key page only where one is known, by id or by name', () => {
    expect(keyPageFor('fal', 'fal.ai')).toBe('https://fal.ai/dashboard/keys')
    // A backend id that is not the company's own name still finds its page.
    expect(keyPageFor('openrouter-images', 'OpenRouter')).toBe('https://openrouter.ai/keys')
    expect(keyPageFor('acme', 'Acme Gateway')).toBeUndefined()
  })

  it('omits the key page entirely rather than sending the person to a wrong address', () => {
    const [row] = joinServices([chatRow('acme', 'Acme Gateway')], [])
    expect(row && 'keyUrl' in row).toBe(false)
  })
})

describe('what a service is called', () => {
  it('gives a route named after its own id the company name instead', () => {
    // llm-pi-ai hands a catalogue route its id as its display name.
    expect(serviceName('openai', 'openai')).toBe('OpenAI')
    expect(serviceName('moonshotai', 'moonshotai')).toBe('Moonshot AI')
  })

  it('keeps a name the registry genuinely supplied', () => {
    expect(serviceName('acme', 'Acme Gateway')).toBe('Acme Gateway')
    expect(serviceName('fal', 'fal.ai')).toBe('fal.ai')
  })

  it('leaves an unknown route under the name the app knows it by', () => {
    expect(serviceName('mystery-route', 'mystery-route')).toBe('mystery-route')
  })

  it('names every chat route the installed catalogue ships', () => {
    // A route the table misses reaches the Services list as its own id
    // ("baseten", "qwen-token-plan-individual" after the 0.85.1 upgrade).
    const unnamed = getBuiltinProviders().filter(provider => serviceName(provider, provider) === provider)
    expect(unnamed).toEqual([])
  })
})

describe('ordering helpers', () => {
  it('drops duplicates while ordering what a service makes', () => {
    expect(orderMakes(['video', 'image', 'video'])).toEqual(['image', 'video'])
  })

  it('sorts equally connected services by name', () => {
    const rows = orderServices([
      { id: 'b', kind: 'chat', name: 'Beta', makes: ['chat'], connected: false },
      { id: 'a', kind: 'chat', name: 'Alpha', makes: ['chat'], connected: false },
    ])
    expect(rows.map(row => row.name)).toEqual(['Alpha', 'Beta'])
  })
})

describe('the chat credential name', () => {
  it('matches the models page derivation, so one key serves both surfaces', () => {
    expect(chatKeyEnv('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(chatKeyEnv('acme-gateway')).toBe('ACME_GATEWAY_API_KEY')
  })
})
