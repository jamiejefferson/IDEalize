import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { Config, resolveProfiles } from '../src/config.ts'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels, retiredReplacements } from '../src/catalog.ts'
import { closestLiveModel, onLiveCatalogChange, setLiveCatalog } from '../src/catalog-addendum.ts'

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

describe('a route\'s live directory', () => {
  afterEach(() => { setLiveCatalog('openrouter', []) })

  const NEW = {
    id: 'example/released-after-this-build', name: 'Example: New', vision: true, reasoning: true,
    contextWindow: 262_144, maxTokens: 65_536, cost: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 0 },
  }

  it('adds a model the installed catalog lacks, on the direct route and on a gateway serving the same catalog', () => {
    expect(catalogModels('openrouter').has(NEW.id)).toBe(false)
    expect(setLiveCatalog('openrouter', [NEW])).toBe(true)
    const direct = catalogModels('openrouter').get(NEW.id)
    expect(direct).toMatchObject({
      name: 'Example: New', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1', input: ['text', 'image'],
      reasoning: true, contextWindow: 262_144, maxTokens: 65_536, cost: NEW.cost,
    })
    const profiles = resolveProfiles({
      'gateway-openrouter': { catalog: 'openrouter', baseURL: 'https://gateway.test/openrouter/v1', apiKeyEnv: 'GATEWAY_API_KEY' },
    })
    const viaGateway = profiles.get('gateway-openrouter')?.piProvider.getModels().find(model => model.id === NEW.id)
    expect(viaGateway).toMatchObject({ provider: 'gateway-openrouter', baseUrl: 'https://gateway.test/openrouter/v1', contextWindow: 262_144 })
  })

  it('leaves an installed model as the catalog describes it, and drops a row it could not serve', () => {
    const installed = [...catalogModels('openrouter').values()][0]
    if (installed === undefined) throw new Error('the installed catalog ships no OpenRouter model')
    const size = catalogModels('openrouter').size
    setLiveCatalog('openrouter', [
      { ...NEW, id: installed.id, contextWindow: 1 },
      { ...NEW, id: 'example/no-window', contextWindow: 0 },
    ])
    expect(catalogModels('openrouter').get(installed.id)?.contextWindow).toBe(installed.contextWindow)
    expect(catalogModels('openrouter').size).toBe(size)
  })

  it('tells its listeners only when the list changes, and ignores a route with no live shape', () => {
    const heard = vi.fn()
    const stop = onLiveCatalogChange(heard)
    setLiveCatalog('openrouter', [NEW])
    setLiveCatalog('openrouter', [NEW])
    expect(heard).toHaveBeenCalledTimes(1)
    expect(setLiveCatalog('anthropic', [NEW])).toBe(false)
    expect(catalogModels('anthropic').has(NEW.id)).toBe(false)
    stop()
    setLiveCatalog('openrouter', [])
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('a model the live directory has stopped listing', () => {
  afterEach(() => { setLiveCatalog('openrouter', []) })

  const shipped = (): string[] => [...catalogModels('openrouter').keys()]

  it('leaves the route, and a saved override for it stays valid configuration', () => {
    const [gone, ...rest] = shipped()
    if (gone === undefined) throw new Error('the installed catalog ships no OpenRouter model')
    setLiveCatalog('openrouter', [], rest)
    const profiles = resolveProfiles({
      'openrouter': { apiKeyEnv: 'OPENROUTER_API_KEY', modelOverrides: { [gone]: { contextWindow: 1000 } } },
      'gateway-openrouter': { catalog: 'openrouter', baseURL: 'https://gateway.test/openrouter/v1', apiKeyEnv: 'GATEWAY_API_KEY' },
    })
    for (const route of ['openrouter', 'gateway-openrouter']) {
      const served = profiles.get(route)?.piProvider.getModels().map(model => model.id) ?? []
      expect(served).not.toContain(gone)
      expect(served).toHaveLength(rest.length)
    }
    const replacement = retiredReplacements('openrouter').get(gone)
    expect(replacement).toBeDefined()
    expect(rest).toContain(replacement)
  })

  it('still answers a chat saved against it, with the model that replaced it', async () => {
    const [gone, ...rest] = shipped()
    if (gone === undefined) throw new Error('the installed catalog ships no OpenRouter model')
    setLiveCatalog('openrouter', [], rest)
    const replacement = retiredReplacements('openrouter').get(gone)
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } }),
      resolveApiKey: () => Promise.resolve('test-key'),
    })
    expect((await adapter.listModels('openrouter')).map(one => one.id)).not.toContain(gone)
    const answered = await adapter.resolveModel('openrouter', gone)
    expect(answered.id).toBe(gone)
    expect(answered.name).toBe(catalogModels('openrouter').get(replacement ?? '')?.name)
    await expect(adapter.resolveModel('openrouter', 'never/shipped')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })

  it('retires nothing before a directory is read, or when the directory lists under half the shipped models', () => {
    expect(retiredReplacements('openrouter').size).toBe(0)
    setLiveCatalog('openrouter', [], shipped().slice(0, 3))
    expect(retiredReplacements('openrouter').size).toBe(0)
    expect(resolveProfiles({ openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } }).get('openrouter')?.piProvider.getModels())
      .toHaveLength(shipped().length)
  })

  const model = (id: string, input: number, output: number, extra: Partial<Model<Api>> = {}): Model<Api> => ({
    id, name: id, api: 'openai-completions', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', reasoning: false,
    input: ['text'], cost: { input, output, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 8_000, ...extra,
  })

  it('is replaced by the newer model of the same maker and family', () => {
    const live = [
      model('anthropic/claude-sonnet-4.5', 3, 15), model('anthropic/claude-haiku-4.5', 1, 5),
      model('anthropic/claude-2-haiku', 0.2, 1), model('openai/gpt-5-mini', 0.25, 1.25),
    ]
    expect(closestLiveModel(model('anthropic/claude-3-haiku', 0.25, 1.25), live)?.id).toBe('anthropic/claude-haiku-4.5')
  })

  it('keeps a dated build with its undated model, and a model that reads pictures with one that still does', () => {
    const live = [model('qwen/qwen-plus', 0.26, 0.78), model('qwen/qwen-max', 0.3, 0.9)]
    expect(closestLiveModel(model('qwen/qwen-plus-2025-07-28', 0.26, 0.78), live)?.id).toBe('qwen/qwen-plus')
    const sighted = [model('acme/view-2', 5, 5), model('acme/view-3', 1, 1, { input: ['text', 'image'] })]
    expect(closestLiveModel(model('acme/view-1', 5, 5, { input: ['text', 'image'] }), sighted)?.id).toBe('acme/view-3')
  })

  it('never moves a free model onto a paid one, and never onto another way of buying', () => {
    const live = [model('minimax/minimax-m3', 0.3, 1.2), model('openrouter/free', 0, 0), model('minimax/minimax-m3:batch', 0.1, 0.5)]
    expect(closestLiveModel(model('minimax/minimax-m3:free', 0, 0), live)?.id).toBe('openrouter/free')
    expect(closestLiveModel(model('minimax/minimax-m3:free', 0, 0), [live[0] as Model<Api>])).toBeUndefined()
    expect(closestLiveModel(model('minimax/minimax-m2', 0.1, 0.5), live)?.id).toBe('minimax/minimax-m3')
  })
})
