/**
 * A failed turn reads as what went wrong and what to do: OpenRouter's 402s
 * (out of credit, or the in-flight budget spent) name the provider and link
 * its credit page; keys, rate limits, outages and the network each get their
 * own line; anything else shows the provider's own sentence.
 */

import { describe, expect, it } from 'vitest'
import { explainFailure } from '../src/failure.ts'

const credits = '402 {"type":"error","error":{"type":"billing_error","message":"This request requires more credits, or fewer max_tokens. You requested up to 64000 tokens, but can only afford 53909. To increase, visit https://openrouter.ai/settings/credits and add more credits","error_type":"payment_required"},"metadata":{"limit_source":"openrouter_credits"}}'
const inFlight = '402 {"type":"error","error":{"type":"billing_error","message":"This request would exceed your available credits given your current in-flight requests.","error_type":"payment_required"},"metadata":{"reason":"in_flight_budget_exhausted"}}'

describe('explainFailure()', () => {
  it('names OpenRouter credit and links its credit page', () => {
    expect(explainFailure({ message: credits, code: 'PI_AI_ERROR' }, 'openrouter')).toEqual({
      text: 'Powell is out of OpenRouter credit. Add credit, then try again.',
      link: { label: 'Add credit', url: 'https://openrouter.ai/settings/credits' },
    })
  })

  it('says other chats are using the last of the credit', () => {
    const explained = explainFailure({ message: inFlight, code: 'PI_AI_ERROR' }, 'openrouter')
    expect(explained.text).toMatch(/nearly out of OpenRouter credit/)
    expect(explained.link?.url).toBe('https://openrouter.ai/settings/credits')
  })

  it('reads the status field as well as the message', () => {
    expect(explainFailure({ message: 'payment needed', code: 'X', status: 402 }, 'anthropic').text).toBe('Powell is out of Anthropic credit. Add credit, then try again.')
  })

  it('explains keys, rate limits, outages and the network', () => {
    expect(explainFailure({ message: '401 invalid api key', code: 'X' }, 'openrouter').text).toBe("OpenRouter refused Powell's key. Check the key in Settings, then try again.")
    expect(explainFailure({ message: '429 Too Many Requests', code: 'X' }, 'deepseek').text).toMatch(/^DeepSeek is limiting/)
    expect(explainFailure({ message: '503 overloaded', code: 'X' }, 'anthropic').text).toBe('Anthropic is having trouble right now. Try again in a moment.')
    expect(explainFailure({ message: 'fetch failed', code: 'X' }, undefined).text).toBe("Powell couldn't reach the model provider. Check your connection, then try again.")
  })

  it('falls back to the provider\'s own sentence', () => {
    expect(explainFailure({ message: '400 {"error":{"message":"Context too long."}}', code: 'X' }, 'openrouter').text).toBe('Something went wrong: Context too long. Try again?')
    expect(explainFailure(undefined).text).toBe('Something went wrong. Try again?')
  })
})
