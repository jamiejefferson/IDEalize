import { describe, expect, it, vi } from 'vitest'
import { clearPreviousLaunchHttpCache } from '../src/http-cache.ts'

describe('startup HTTP cache clearing', () => {
  it('clears the session cache once', async () => {
    const clearCache = vi.fn(async () => {})
    const warn = vi.fn()

    await clearPreviousLaunchHttpCache({ clearCache }, warn)

    expect(clearCache).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a rejected clear and does not throw', async () => {
    const warn = vi.fn()

    await expect(clearPreviousLaunchHttpCache(
      { clearCache: async () => { throw new Error('cache backend busy') } },
      warn,
    )).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith('HTTP cache of earlier launches was not cleared: cache backend busy')
  })
})
