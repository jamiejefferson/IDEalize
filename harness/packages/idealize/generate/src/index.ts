/**
 * @idealize/generate — the generation capability seam. Default-exports the
 * `GenerationRuntime` service (`ctx.generation`): backends register
 * `{id, describe, models, refresh?, generate}` and the runtime answers
 * catalogue, compatibility, and availability queries and dispatches
 * generations. Also carries the shared `GenerationError` contract, the
 * default media presets (Images, Motion, Sound), and the
 * `/idealize/brains/media` preset↔model routes (mounted while a web server
 * and settings service are composed).
 * @module @idealize/generate
 */

export * from './types.ts'
export * from './error.ts'
export * from './compat.ts'
export * from './media.ts'
export { GENERATION_SCHEMA_VERSION, GenerationRuntime } from './service.ts'

export { default } from './service.ts'
