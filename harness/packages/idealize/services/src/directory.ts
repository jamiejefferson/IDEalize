/**
 * The service directory, pure data plus the join that turns it into the list
 * the Services section renders.
 *
 * A service is a company the person has an account with. What it sells — chat,
 * images, video, sound — is the service's business to state, not a category
 * the person navigates before they can add it. So one list carries both the
 * chat routes `ctx.llm` knows and the generation backends registered with
 * `ctx.generation`, and the row says what each one makes.
 *
 * The directory itself only carries what the running app cannot already tell
 * us: the page where a service issues API keys, and the order the list reads
 * best in. Names, availability and what a service makes all come from the
 * running registries, so a service the app gains needs no entry here to appear.
 * @module @idealize/services/directory
 */

/** What a service produces, in the vocabulary the row shows the person. */
export type ServiceMakes = 'chat' | 'image' | 'video' | 'audio'

/** How a service's key is stored: through the chat provider profile, or the generation seam. */
export type ServiceKind = 'chat' | 'media'

/** One row of the Services list. */
export interface ServiceRow {
  /** Chat route id, or generation backend id; unique within its kind. */
  id: string
  kind: ServiceKind
  /** The service's own name for itself. */
  name: string
  /** What it makes, in {@link MAKES_ORDER}. */
  makes: readonly ServiceMakes[]
  /** True while a key (or sign-in) is stored and the service can be used. */
  connected: boolean
  /** The page where this service issues API keys, when one is known. */
  keyUrl?: string
  /** True while this service is signed into rather than keyed; it is added elsewhere. */
  signIn?: boolean
}

/**
 * Where each known service issues API keys. A person who has no key yet needs
 * to be told where to get one, and a wrong address is worse than none — so a
 * service absent from this table renders its key field with no link rather
 * than a guess.
 */
export const KEY_PAGES: Readonly<Record<string, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  fal: 'https://fal.ai/dashboard/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
}

/**
 * How a service names itself. The LLM directory hands a catalogue route its id
 * as its display name (`declare(provider, provider)` in `llm-pi-ai`), so
 * without this table the list would read "openai" and "moonshotai" — labels
 * belonging to the configuration file, not to the company the person holds an
 * account with. A route absent from this table keeps its id, which is honest:
 * it is what the app knows the route as.
 */
export const SERVICE_NAMES: Readonly<Record<string, string>> = {
  'amazon-bedrock': 'Amazon Bedrock',
  'ant-ling': 'Ant Ling',
  'anthropic': 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  'baseten': 'Baseten',
  'cerebras': 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'deepseek': 'DeepSeek',
  'deepseek-official': 'DeepSeek (official)',
  'fireworks': 'Fireworks AI',
  'github-copilot': 'GitHub Copilot',
  'google': 'Google AI Studio',
  'google-vertex': 'Google Vertex AI',
  'groq': 'Groq',
  'huggingface': 'Hugging Face',
  'kimi-coding': 'Kimi Coding',
  'minimax': 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  'mistral': 'Mistral AI',
  'moonshotai': 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI (China)',
  'nvidia': 'NVIDIA',
  'openai': 'OpenAI',
  'openai-codex': 'ChatGPT (Codex)',
  'opencode': 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'openrouter': 'OpenRouter',
  'qwen-token-plan': 'Qwen',
  'qwen-token-plan-cn': 'Qwen (China)',
  'qwen-token-plan-individual': 'Qwen (individual plan)',
  'together': 'Together AI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'xai': 'xAI',
  'xiaomi': 'Xiaomi',
  'xiaomi-token-plan-ams': 'Xiaomi (Amsterdam)',
  'xiaomi-token-plan-cn': 'Xiaomi (China)',
  'xiaomi-token-plan-sgp': 'Xiaomi (Singapore)',
  'zai': 'Z.ai',
  'zai-coding-cn': 'Z.ai Coding (China)',
}

/**
 * Display order for what a service makes, so two services that make the same
 * things describe themselves identically.
 */
export const MAKES_ORDER: readonly ServiceMakes[] = ['chat', 'image', 'video', 'audio']

/**
 * Sort `makes` into {@link MAKES_ORDER} and drop duplicates.
 * @param makes - what a service reported making, in any order.
 * @returns the same kinds in display order.
 */
export function orderMakes(makes: Iterable<ServiceMakes>): ServiceMakes[] {
  const held = new Set(makes)
  return MAKES_ORDER.filter(kind => held.has(kind))
}

/**
 * The list order: connected services first so the person sees what they
 * already have, then alphabetically by name within each group. Nothing is
 * ranked by how much we would like it used.
 * @param rows - the joined rows in registry order.
 * @returns the rows to render, in display order.
 */
export function orderServices(rows: readonly ServiceRow[]): ServiceRow[] {
  return [...rows].sort((left, right) => {
    if (left.connected !== right.connected) return left.connected ? -1 : 1
    return left.name.localeCompare(right.name)
  })
}
