import { describe, expect, it } from 'vitest'
import { Config, resolveProfiles } from '../src/config.ts'
import { catalogModels } from '../src/catalog.ts'

describe('a route serving another provider\'s catalog', () => {
  it('keeps every installed model and its sizes, at the gateway\'s address', () => {
    const profiles = resolveProfiles({
      'gateway-anthropic': { catalog: 'anthropic', baseURL: 'https://gateway.test/anthropic', apiKeyEnv: 'GATEWAY_API_KEY' },
    })
    const route = profiles.get('gateway-anthropic')
    const models = route?.piProvider.getModels() ?? []
    const installed = catalogModels('anthropic')
    expect(models.length).toBe(installed.size)
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      const original = installed.get(model.id)
      expect(model.provider).toBe('gateway-anthropic')
      expect(model.baseUrl).toBe('https://gateway.test/anthropic')
      expect(model.api).toBe(original?.api)
      expect(model.contextWindow).toBe(original?.contextWindow)
      expect(model.reasoning).toBe(original?.reasoning)
    }
  })

  it('refuses a catalog the installed set does not ship, and passes the schema', () => {
    expect(() => resolveProfiles({ 'gateway-x': { catalog: 'no-such-provider', baseURL: 'https://gateway.test/x' } }))
      .toThrow(/names catalog "no-such-provider"/u)
    expect(() => Config({ providers: { 'gateway-openrouter': { catalog: 'openrouter', baseURL: 'https://gateway.test/openrouter/v1' } } }))
      .not.toThrow()
  })
})
