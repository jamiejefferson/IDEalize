/**
 * Gate for the IDEalize mode/provider boundary (spec AC-03 and AC-14).
 *
 * A mode is a view the user works in; a provider is a service that answers a
 * generation or chat request. The product decision is that the two never meet
 * in source: a mode names a capability, the router picks a model, and the
 * chosen model id lives in the settings document. This gate is the mechanical
 * half of that decision.
 *
 * ## What it polices
 *
 * 1. **Import graph** — no mode package reaches a provider SDK or a Service
 *    Provider package, directly or through its declared runtime dependency
 *    closure. Walking the closure (not just the direct import) is what makes
 *    the rule hold: re-exporting an adapter through a helper package would
 *    otherwise pass.
 * 2. **Model-id literals** — no mode package, and no default media preset
 *    definition, carries a model identifier.
 * 3. **Provider-id literals** — no mode package hard-names a backend.
 *
 * ## Why not a substring scan
 *
 * A scan for `openrouter` or `openai` over these packages matches translated
 * UI prose ("Add OpenRouter key"), test fixtures that legitimately mount an
 * adapter, and every `@deepseek-ai/*` import specifier. Three narrowings keep
 * the signal:
 *
 * - **Shipped source only.** Rules read `src/**`. A package's `tests/` mount
 *   adapters on purpose — that is how AC-01 and AC-02 are proven — and its
 *   `devDependencies` may name them.
 * - **Whole-literal identifier match**, never a substring. `'openrouter'` is a
 *   backend selection; `'Add OpenRouter key'` is a sentence a translator owns.
 * - **Structural discovery over hardcoded lists.** Mode packages and Service
 *   Provider packages are both found by what their source does, so a view or
 *   an adapter added later is policed without editing this file.
 *
 * The `vendor/model` slug shape alone cannot carry the model-id rule: session
 * event names (`artefact/created`), media types (`image/png`) and module
 * specifiers (`react/jsx-runtime`) all share it, and every one of those is
 * ordinary mode code. The rule therefore fires on three targeted signals
 * instead — a first segment in {@link MODEL_VENDORS}, a bare model family in
 * {@link BARE_MODEL_ID}, or a literal an adapter package publishes as a
 * catalogue `id:`. The third makes the gate follow the adapters: a model from
 * a vendor nobody listed here is still caught once an adapter ships it.
 *
 * @module scripts/verify-mode-provider-boundary
 */

import { globSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Third-party model-vendor clients. Reaching one from a mode package is a
 * direct provider call, which is exactly what AC-03 asks to detect.
 */
export const PROVIDER_SDKS: readonly string[] = [
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/sdk',
  '@earendil-works/pi-ai',
  '@fal-ai/client',
  '@google/generative-ai',
  '@mistralai/mistralai',
  'cohere-ai',
  'ollama',
  'openai',
  'replicate',
]

/**
 * Registration calls that make a package a Service Provider for a model
 * capability. Detection is structural so a new adapter is covered on the day
 * it registers, without a list to update here. The receiver is required: the
 * Service Definition that declares `register` must not be mistaken for a
 * provider that calls it through a context.
 */
const PROVIDER_REGISTRATION
  = /\b(?:ctx|context|[A-Za-z_$][\w$]*Ctx)\.(?:generation\.register|llm\.registerAdapter|llm\.registerConfigurableProviders)\s*\(/

/** The slot name a package registers to take a seat in the conversation view ring. */
const VIEW_RING_REGISTRATION = /name:\s*'conversation\.view'/

/** The export that makes a source the default media preset definitions AC-14 covers. */
const PRESET_DECLARATION = /export const MEDIA_PRESETS\b/

/** A `vendor/model` catalogue slug, the form every routed catalogue uses. */
const MODEL_SLUG = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.:-]*$/

/**
 * Model vendors as the routed catalogues spell them. Sourced from OpenRouter's
 * `/models` namespaces; extended by whatever the adapters publish as a
 * catalogue `id:`, so this list does not have to stay exhaustive.
 */
const MODEL_VENDORS = new Set([
  'ai21', 'amazon', 'anthropic', 'black-forest-labs', 'bytedance', 'cohere', 'deepseek',
  'elevenlabs', 'google', 'ideogram', 'inflection', 'luma', 'meta-llama', 'microsoft',
  'minimax', 'mistralai', 'moonshotai', 'nvidia', 'openai', 'perplexity', 'playai',
  'qwen', 'recraft', 'runway', 'stability-ai', 'x-ai', 'z-ai',
])

/** The catalogue-entry form adapters declare their model ids in. */
const CATALOGUE_ID = /\bid:\s*'([^'\n]+)'/g

/** Bare model families that ship without a vendor prefix. */
const BARE_MODEL_ID = /^(?:gpt|claude|gemini|deepseek|llama|mistral|qwen|grok|flux|sora|dall-e|whisper|kimi|sonar)[-.][a-z0-9]/i

/**
 * Backend ids the router and the settings document own. A mode package
 * writing one of these has chosen a provider for the user.
 */
const PROVIDER_IDS = new Set([
  'anthropic', 'deepseek', 'fal', 'fixture', 'freellmapi', 'mistral', 'ollama',
  'openai', 'openai-codex', 'openrouter', 'replicate', 'xai',
])

/** One workspace package as the gate reads it. */
interface WorkspacePackage {
  /** Package name from package.json. */
  name: string
  /** Repository-relative directory, `/`-separated. */
  dir: string
  /** Declared runtime dependencies (devDependencies stay out: tests may mount adapters). */
  dependencies: readonly string[]
  /** Repository-relative paths of every `src/**` TypeScript file. */
  sources: readonly string[]
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

/**
 * Read every workspace package under `packages/`.
 * @param root - repository root.
 * @returns one record per package, keyed by package name.
 */
export function readWorkspace(root: string): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>()
  for (const manifest of globSync('packages/*/*/package.json', { cwd: root })) {
    const rel = toPosix(manifest)
    const json = readJson(resolve(root, rel))
    const name = typeof json.name === 'string' ? json.name : undefined
    if (name === undefined) continue
    const dir = dirname(rel)
    const dependencies = Object.keys(json.dependencies ?? {})
    // oxlint-contract-* files are the lint contract gate's transient probes: a
    // concurrent run can delete one between this glob and the read, so they
    // are never part of the shipped-source scan.
    const sources = globSync(`${dir}/src/**/*.{ts,tsx}`, { cwd: root })
      .map(toPosix)
      .filter(file => !basename(file).startsWith('oxlint-contract-'))
      .sort()
    packages.set(name, { name, dir, dependencies, sources })
  }
  return packages
}

/**
 * Whether any of a package's shipped sources matches a pattern on a code
 * line. Comment lines are skipped: a JSDoc example of `ctx.llm.registerAdapter`
 * documents the seam rather than filling it.
 */
function sourceMatches(root: string, pkg: WorkspacePackage, pattern: RegExp): boolean {
  return pkg.sources.some(file =>
    readFileSync(resolve(root, file), 'utf8')
      .split('\n')
      .some((line) => {
        const trimmed = line.trimStart()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return false
        return pattern.test(line)
      }))
}

/**
 * The packages the boundary rules apply to: everything under
 * `packages/idealize/` that either carries the `ui-` prefix or takes a seat in
 * the conversation view ring. The second test is what covers a view package
 * added after this gate was written.
 * @param root - repository root.
 * @param packages - the workspace read by {@link readWorkspace}.
 * @returns the mode packages, in package-name order.
 */
export function discoverModePackages(root: string, packages: Map<string, WorkspacePackage>): WorkspacePackage[] {
  const modes: WorkspacePackage[] = []
  for (const pkg of packages.values()) {
    if (!pkg.dir.startsWith('packages/idealize/')) continue
    const named = basename(pkg.dir).startsWith('ui-')
    if (!named && !sourceMatches(root, pkg, VIEW_RING_REGISTRATION)) continue
    modes.push(pkg)
  }
  return modes.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The Service Provider packages: those whose shipped source registers a
 * generation backend or an LLM adapter.
 * @param root - repository root.
 * @param packages - the workspace read by {@link readWorkspace}.
 * @returns the adapter package names, sorted.
 */
export function discoverAdapterPackages(root: string, packages: Map<string, WorkspacePackage>): string[] {
  const adapters: string[] = []
  for (const pkg of packages.values()) {
    if (sourceMatches(root, pkg, PROVIDER_REGISTRATION)) adapters.push(pkg.name)
  }
  return adapters.sort()
}

/**
 * Every package reachable from a mode package's declared runtime
 * dependencies, the mode package excluded.
 */
function runtimeClosure(packages: Map<string, WorkspacePackage>, start: WorkspacePackage): Map<string, string[]> {
  // Value is the dependency path taken to reach the key, so a failure can name it.
  const reached = new Map<string, string[]>()
  const queue: { name: string; path: string[] }[] = start.dependencies.map(name => ({ name, path: [name] }))
  for (let head = 0; head < queue.length; head += 1) {
    const { name, path } = queue[head] as { name: string; path: string[] }
    if (reached.has(name)) continue
    reached.set(name, path)
    for (const next of packages.get(name)?.dependencies ?? []) {
      if (!reached.has(next)) queue.push({ name: next, path: [...path, next] })
    }
  }
  return reached
}

/** Import and export specifiers, and the lines they sit on, for one source file. */
function importSpecifiers(source: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = []
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const [, specifier = ''] = match
      found.push({ specifier, line: index + 1 })
    }
  })
  return found
}

/** The package a module specifier belongs to (`@scope/name` or `name`). */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * String literals in a source, with the import and export statements removed
 * first so module specifiers never reach the literal rules.
 */
function contentLiterals(source: string): { value: string; line: number }[] {
  const literals: { value: string; line: number }[] = []
  source.split('\n').forEach((text, index) => {
    const stripped = text.replace(/(?:from|import)\s*\(?\s*['"][^'"]+['"]/g, '')
    for (const match of stripped.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
      literals.push({ value: match[1] ?? match[2] ?? '', line: index + 1 })
    }
  })
  return literals
}

/**
 * The model ids the adapter packages publish, harvested from their catalogue
 * declarations so a vendor absent from {@link MODEL_VENDORS} is still caught.
 */
function publishedModelIds(root: string, packages: Map<string, WorkspacePackage>, adapters: Iterable<string>): Set<string> {
  const ids = new Set<string>()
  for (const name of adapters) {
    for (const file of packages.get(name)?.sources ?? []) {
      const source = readFileSync(resolve(root, file), 'utf8')
      for (const match of source.matchAll(CATALOGUE_ID)) {
        const [, id = ''] = match
        if (MODEL_SLUG.test(id)) ids.add(id)
      }
    }
  }
  return ids
}

/**
 * Terminal CLI launcher ids that collide with {@link BARE_MODEL_ID}. AC-14
 * covers model choice; a CLI product id names a launchable tool, not a model,
 * so these stay legal in mode source (`@idealize/ui-terminal`'s catalogue).
 */
const CLI_LAUNCHER_IDS = new Set(['claude-code'])

/** Whether a literal names a model in a catalogue. */
function isModelId(value: string, published: ReadonlySet<string>): boolean {
  if (CLI_LAUNCHER_IDS.has(value.toLowerCase())) return false
  if (BARE_MODEL_ID.test(value)) return true
  if (published.has(value)) return true
  if (!MODEL_SLUG.test(value)) return false
  return MODEL_VENDORS.has(value.slice(0, value.indexOf('/')))
}

/**
 * Collect every mode/provider boundary violation in a repository tree.
 * @param root - repository root to check.
 * @returns one message per violation, ordered by rule then file.
 */
export function collectModeProviderBoundaryViolations(root: string): string[] {
  const packages = readWorkspace(root)
  const modes = discoverModePackages(root, packages)
  const adapters = new Set(discoverAdapterPackages(root, packages))
  const providers = new Set([...PROVIDER_SDKS, ...adapters])
  const published = publishedModelIds(root, packages, adapters)
  const failures: string[] = []

  for (const mode of modes) {
    // Rule 1a: the declared runtime closure.
    for (const [name, path] of runtimeClosure(packages, mode)) {
      if (!providers.has(name)) continue
      failures.push(
        `${mode.name}: depends on the provider ${name} (through ${path.join(' → ')}).`
        + ' A mode names a capability and lets ctx.generation route it; only adapter packages'
        + ' and settings may name a provider.',
      )
    }
    // Rule 1b: an import the manifest does not declare.
    for (const file of mode.sources) {
      const source = readFileSync(resolve(root, file), 'utf8')
      for (const { specifier, line } of importSpecifiers(source)) {
        const owner = packageOf(specifier)
        if (owner === undefined || !providers.has(owner)) continue
        failures.push(
          `${file}:${String(line)}: imports the provider ${owner}.`
          + ' A mode names a capability and lets ctx.generation route it; only adapter packages'
          + ' and settings may name a provider.',
        )
      }
    }
  }

  // Rules 2 and 3: literals in mode source and in the preset definitions.
  const literalScan = [
    ...modes.flatMap(mode => mode.sources),
    ...discoverPresetSources(root, packages),
  ]
  for (const file of literalScan) {
    const source = readFileSync(resolve(root, file), 'utf8')
    for (const { value, line } of contentLiterals(source)) {
      if (isModelId(value, published)) {
        failures.push(
          `${file}:${String(line)}: names the model ${JSON.stringify(value)}.`
          + ' The chosen model id lives in the settings document; code carries capability'
          + ' identifiers only (AC-14).',
        )
      }
      if (PROVIDER_IDS.has(value.toLowerCase())) {
        failures.push(
          `${file}:${String(line)}: names the provider ${JSON.stringify(value)}.`
          + ' Provider ids belong to adapter packages and to the settings document (AC-03).',
        )
      }
    }
  }
  return failures
}

/**
 * The default media preset definitions: the sources declaring `MEDIA_PRESETS`.
 * Found by declaration rather than by path so a move keeps the AC-14 rule on
 * them.
 * @param root - repository root.
 * @param packages - the workspace read by {@link readWorkspace}.
 * @returns the repository-relative preset sources, sorted.
 */
export function discoverPresetSources(root: string, packages: Map<string, WorkspacePackage>): string[] {
  const sources: string[] = []
  for (const pkg of packages.values()) {
    for (const file of pkg.sources) {
      if (PRESET_DECLARATION.test(readFileSync(resolve(root, file), 'utf8'))) sources.push(file)
    }
  }
  return sources.sort()
}

/**
 * The scope the gate found, for the report line and for the anti-vacuity
 * assertion that a rename cannot empty it.
 * @param root - repository root to inspect.
 * @returns the mode packages, adapter packages, and preset sources it will police.
 */
export function describeScope(root: string): { modes: string[]; adapters: string[]; presets: string[] } {
  const packages = readWorkspace(root)
  return {
    modes: discoverModePackages(root, packages).map(mode => mode.name),
    adapters: discoverAdapterPackages(root, packages),
    presets: discoverPresetSources(root, packages),
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  // A tree with no mode packages, or no preset definitions, would pass every
  // rule vacuously.
  const { modes, adapters, presets } = describeScope(ROOT)
  const empty = [
    ...modes.length === 0 ? ['mode packages under packages/idealize/'] : [],
    ...presets.length === 0 ? ['sources declaring MEDIA_PRESETS'] : [],
  ]
  if (empty.length > 0) {
    process.stderr.write(
      `verify-mode-provider-boundary: found no ${empty.join(' and no ')}.`
      + ' Either those sources moved or the discovery rules stopped matching; the gate refuses'
      + ' to pass on an empty scope.\n',
    )
    process.exit(1)
  }
  const failures = collectModeProviderBoundaryViolations(ROOT)
  if (failures.length > 0) {
    process.stderr.write('verify-mode-provider-boundary: the mode/provider boundary is crossed:\n')
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `verify-mode-provider-boundary: ${String(modes.length)} mode packages (${modes.join(', ')})`
    + ` reach none of the ${String(adapters.length)} adapter packages (${adapters.join(', ')})`
    + ' or their SDKs, and neither they nor the preset definitions'
    + ` (${presets.join(', ')}) carry a model or provider id.\n`,
  )
}
