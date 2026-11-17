import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { catalogAddendum, setLiveCatalog as adapterSetLiveCatalog } from '@deepseek-ai/dsh-llm-pi-ai'
import { describe, expect, it } from 'vitest'
import { setLiveCatalog } from '../src/index.ts'

describe('live model list seam', () => {
  it('declares the chat adapter as a runtime dependency, so the build never copies it into this package', () => {
    // The live list lives in the adapter's module. A development-only dependency is bundled into this package's
    // build, which gives it a second, private list: OpenRouter's models then never reach the picker (1.0.25 to
    // 1.0.28 shipped that way, found 17 Nov 2026).
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-llm-pi-ai')
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-llm-pi-ai')
  })

  it('hands a live model to the list the chat adapter reads', () => {
    expect(setLiveCatalog).toBe(adapterSetLiveCatalog)
    const row = {
      id: 'seam/probe', name: 'Seam probe', vision: false, reasoning: false, contextWindow: 1000, maxTokens: 100,
      cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    }
    setLiveCatalog('openrouter', [row], ['seam/probe'])
    expect(catalogAddendum('openrouter', new Set()).some(model => model.id === 'seam/probe')).toBe(true)
    setLiveCatalog('openrouter', [], [])
  })
})
