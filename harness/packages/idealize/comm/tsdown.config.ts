import { defineConfig } from 'tsdown'

/**
 * Two entries: the plugin module and the `idealize` bin. The root tsdown
 * builds only `lib/types/index.js`; the bin needs its own bundle.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/cli.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
