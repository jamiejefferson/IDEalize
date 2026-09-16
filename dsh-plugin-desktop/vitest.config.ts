import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    // Profile and installer tests build real package closures on disk; on a
    // loaded developer machine they pass in 6 to 12 s, so the default 5 s
    // timeout reported false failures during packaging runs (16 Sep 2026).
    testTimeout: 20_000,
  },
})
