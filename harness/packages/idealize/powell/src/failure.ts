/**
 * Turn a failed turn's provider error into one plain line for the bubble,
 * plus a link when there is somewhere to go and fix it. Powell used to say
 * "Something went wrong" for every failure, so running out of OpenRouter
 * credit looked like a broken app.
 */

/** The parts of an `LlmFailure` this reads. */
export interface FailureLike {
  message?: string
  code?: string
  status?: number
}

/** What the bubble shows. */
export interface ExplainedFailure {
  text: string
  /** Where the person fixes it, opened by the bubble's first button. */
  link?: { label: string; url: string }
}

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  google: 'Google',
  gemini: 'Google',
  mistral: 'Mistral',
  groq: 'Groq',
  xai: 'xAI',
}

const CREDIT_PAGES: Record<string, string> = {
  OpenRouter: 'https://openrouter.ai/settings/credits',
  Anthropic: 'https://console.anthropic.com/settings/billing',
  OpenAI: 'https://platform.openai.com/settings/organization/billing',
  DeepSeek: 'https://platform.deepseek.com/top_up',
}

function providerName(provider: string | undefined, message: string): string | undefined {
  if (/openrouter/i.test(message)) return 'OpenRouter'
  if (provider === undefined || provider === '') return undefined
  return PROVIDER_NAMES[provider.toLowerCase()] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** The provider's own sentence, dug out of a "402 {json}" message when there is one. */
function innerMessage(message: string): string {
  const start = message.indexOf('{')
  if (start >= 0) {
    try {
      const body = JSON.parse(message.slice(start)) as { error?: { message?: unknown } | string; message?: unknown }
      const inner = typeof body.error === 'object' ? body.error.message : typeof body.error === 'string' ? body.error : body.message
      if (typeof inner === 'string' && inner.trim() !== '') return inner.trim()
    } catch {
      // Not JSON: use the message as it is.
    }
  }
  return message.trim()
}

function statusOf(failure: FailureLike, message: string): number | undefined {
  if (failure.status !== undefined) return failure.status
  const leading = /^\s*(\d{3})\b/.exec(message)
  return leading === null ? undefined : Number(leading[1])
}

/**
 * Explain a failed turn in one or two short sentences.
 * @param failure - the turn's error, when the session recorded one.
 * @param provider - the provider id Powell's chat runs on.
 * @returns the bubble line and an optional fix-it link.
 */
export function explainFailure(failure: FailureLike | undefined, provider?: string): ExplainedFailure {
  const message = failure?.message ?? ''
  const name = providerName(provider, message)
  const who = name ?? 'the model provider'
  const status = failure === undefined ? undefined : statusOf(failure, message)

  if (status === 402 || /billing_error|payment_required|insufficient[_ ]credit|more credits|in_flight_budget/i.test(message)) {
    const url = name === undefined ? undefined : CREDIT_PAGES[name] ?? /https:\/\/[^\s"'\\]+credits?[^\s"'\\]*/i.exec(message)?.[0]
    const link = url === undefined ? undefined : { label: 'Add credit', url }
    if (/in_flight_budget/i.test(message)) {
      return { text: `Powell is nearly out of ${name ?? 'model'} credit, and other chats are using what's left. Add credit, or wait two minutes and try again.`, ...link === undefined ? {} : { link } }
    }
    return { text: `Powell is out of ${name ?? 'model'} credit. Add credit, then try again.`, ...link === undefined ? {} : { link } }
  }
  if (status === 401 || status === 403 || /invalid[_ ]api[_ ]key|unauthori[sz]ed|authentication/i.test(message)) {
    return { text: `${capital(who)} refused Powell's key. Check the key in Settings, then try again.` }
  }
  if (status === 429 || /rate[_ ]limit|too many requests/i.test(message)) {
    return { text: `${capital(who)} is limiting how often Powell can ask. Wait a minute, then try again.` }
  }
  if ((status !== undefined && status >= 500) || /overloaded|service unavailable|bad gateway/i.test(message)) {
    return { text: `${capital(who)} is having trouble right now. Try again in a moment.` }
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|network|timed out/i.test(message)) {
    return { text: `Powell couldn't reach ${who}. Check your connection, then try again.` }
  }
  const detail = innerMessage(message).replace(/\s+/g, ' ')
  if (detail === '') return { text: 'Something went wrong. Try again?' }
  const short = detail.length > 140 ? `${detail.slice(0, 137).trimEnd()}…` : detail
  return { text: `Something went wrong: ${short.replace(/[.!?…]*$/, '')}. Try again?` }
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
