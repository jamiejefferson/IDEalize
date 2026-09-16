import { describe, expect, it } from 'vitest'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { SHIPPED_PRICE_CURRENCY, shippedTokenPrices } from '../src/shipped-prices.ts'

describe('shippedTokenPrices', () => {
  it('reads the catalogue cost of every priced model on a shipped route, dropping all-zero rows', () => {
    const prices = shippedTokenPrices('anthropic')
    expect(prices).toBeDefined()
    const catalogue = getBuiltinModels('anthropic')
    const first = catalogue.find(model => model.cost.output > 0)!
    expect(prices![first.id]).toEqual({
      input: first.cost.input,
      output: first.cost.output,
      cacheRead: first.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite,
    })
    // OpenRouter's catalogue carries the `:free` routes at zero and its two
    // auto routers at -1000000, since their price follows the model picked;
    // both spellings mean no figure.
    const openrouter = shippedTokenPrices('openrouter')
    expect(openrouter).toBeDefined()
    expect(openrouter!['auto']).toBeUndefined()
    expect(openrouter!['auto-beta']).toBeUndefined()
    for (const price of Object.values(openrouter!)) {
      expect(price.input + price.output + price.cacheRead + price.cacheWrite).toBeGreaterThan(0)
    }
    expect(SHIPPED_PRICE_CURRENCY).toBe('USD')
  })

  it('answers nothing for a route the catalogue does not ship, or ships with every cost at zero', () => {
    expect(shippedTokenPrices('freetokens')).toBeUndefined()
    expect(shippedTokenPrices('acme-gateway')).toBeUndefined()
    // A token-plan route: the catalogue lists its models and prices none of them.
    expect(shippedTokenPrices('xiaomi-token-plan-ams')).toBeUndefined()
  })
})
