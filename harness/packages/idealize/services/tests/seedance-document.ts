/**
 * fal's OpenAPI document for `fal-ai/bytedance/seedance/v1.5/pro/text-to-video`,
 * as fetched on 7 Sep 2026 with the output schema trimmed: the endpoint whose
 * string-enum `duration` refused the number the seam sent.
 */

export const SEEDANCE_DOCUMENT = {
  openapi: '3.0.4',
  components: {
    schemas: {
      QueueStatus: { type: 'object', properties: { status: { type: 'string', enum: ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'] } } },
      BytedanceSeedanceV15ProTextToVideoInput: {
        'x-fal-order-properties': ['prompt', 'aspect_ratio', 'resolution', 'duration', 'camera_fixed', 'seed', 'enable_safety_checker', 'generate_audio'],
        required: ['prompt'],
        type: 'object',
        title: 'SeedanceProv15TextToVideoInput',
        properties: {
          seed: { title: 'Seed', anyOf: [{ type: 'integer' }, { type: 'null' }] },
          camera_fixed: { title: 'Camera Fixed', type: 'boolean', default: false },
          prompt: { title: 'Prompt', type: 'string' },
          resolution: { title: 'Resolution', type: 'string', default: '720p', enum: ['480p', '720p', '1080p'] },
          generate_audio: { title: 'Generate Audio', type: 'boolean', default: true },
          duration: { title: 'Duration', type: 'string', default: '5', enum: ['4', '5', '6', '7', '8', '9', '10', '11', '12'] },
          aspect_ratio: { title: 'Aspect Ratio', type: 'string', default: '16:9', enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'auto'] },
          enable_safety_checker: { title: 'Enable Safety Checker', type: 'boolean', default: true },
        },
      },
      BytedanceSeedanceV15ProTextToVideoOutput: { type: 'object', properties: { video: { $ref: '#/components/schemas/File' } } },
    },
  },
}
