/**
 * The shipped capability table. Scores are editorial estimates on a 0 to 1
 * scale, written by family so a new version inherits its family's row until
 * someone scores it. They are not benchmark figures. A user's own table in
 * the harness home (`router-scores.json`, same shape) is read over this one.
 *
 * Order matters: the first row whose pattern matches the model id wins, so a
 * family's small variants sit above the family's general row.
 */

import type { Capability } from './tasks.ts'

export interface ScoreRow {
  /** Matched against the lower-cased model id, maker prefix included. */
  pattern: string
  /** Shown in the settings' table and in a rationale. */
  family: string
  scores: Record<Capability, number>
  /** How quickly the family answers, 0 to 1. Price and context size come live; speed has no live source. */
  speed: number
}

const row = (
  pattern: string, family: string, speed: number,
  reasoning: number, coding: number, math: number, writing: number, instructions: number, multilingual: number,
): ScoreRow => ({ pattern, family, speed, scores: { reasoning, coding, math, writing, instructions, multilingual } })

export const SHIPPED_SCORES: readonly ScoreRow[] = [
  //   pattern                            family              speed  reas  code  math  writ  inst  multi
  row('claude.*(fable|mythos)',           'Claude Fable',     0.45,  0.98, 0.97, 0.95, 0.95, 0.96, 0.92),
  row('claude.*opus',                     'Claude Opus',      0.50,  0.95, 0.94, 0.92, 0.94, 0.94, 0.90),
  row('claude.*sonnet',                   'Claude Sonnet',    0.72,  0.88, 0.92, 0.86, 0.90, 0.93, 0.88),
  row('claude.*haiku',                    'Claude Haiku',     0.92,  0.72, 0.78, 0.68, 0.78, 0.86, 0.80),
  row('gpt-[5-9].*(nano)',                'GPT nano',         0.97,  0.55, 0.58, 0.52, 0.62, 0.74, 0.72),
  row('gpt-[5-9].*(mini|spark)',          'GPT mini',         0.92,  0.72, 0.78, 0.72, 0.74, 0.84, 0.80),
  row('gpt-[5-9].*codex',                 'GPT Codex',        0.62,  0.88, 0.95, 0.86, 0.70, 0.90, 0.78),
  row('gpt-[5-9]',                        'GPT',              0.60,  0.93, 0.91, 0.93, 0.88, 0.92, 0.90),
  row('(^|/)o[1-9](-|$)',                 'OpenAI o-series',  0.35,  0.93, 0.88, 0.95, 0.72, 0.84, 0.82),
  row('gpt-4.*mini',                      'GPT-4 mini',       0.92,  0.62, 0.66, 0.60, 0.70, 0.80, 0.78),
  row('gpt-4',                            'GPT-4',            0.70,  0.80, 0.80, 0.78, 0.82, 0.86, 0.85),
  row('gemini.*(flash-lite|lite)',        'Gemini Flash Lite', 0.97, 0.58, 0.60, 0.58, 0.64, 0.76, 0.84),
  row('gemini.*flash',                    'Gemini Flash',     0.93,  0.76, 0.78, 0.78, 0.76, 0.84, 0.90),
  row('gemini',                           'Gemini Pro',       0.58,  0.92, 0.89, 0.93, 0.86, 0.89, 0.94),
  row('deepseek.*(r1|reasoner)',          'DeepSeek Reasoner', 0.35, 0.90, 0.86, 0.93, 0.70, 0.80, 0.80),
  row('deepseek.*flash',                  'DeepSeek Flash',   0.90,  0.76, 0.82, 0.78, 0.70, 0.82, 0.80),
  row('deepseek',                         'DeepSeek',         0.60,  0.88, 0.90, 0.90, 0.76, 0.86, 0.82),
  row('grok.*(mini|fast)',                'Grok fast',        0.90,  0.72, 0.76, 0.74, 0.70, 0.80, 0.78),
  row('grok',                             'Grok',             0.60,  0.88, 0.86, 0.88, 0.80, 0.84, 0.82),
  row('qwen.*coder',                      'Qwen Coder',       0.75,  0.76, 0.88, 0.76, 0.60, 0.82, 0.80),
  row('qwen|qwq',                         'Qwen',             0.72,  0.80, 0.80, 0.82, 0.72, 0.82, 0.90),
  row('kimi|moonshot',                    'Kimi',             0.62,  0.84, 0.86, 0.82, 0.78, 0.84, 0.84),
  row('glm',                              'GLM',              0.68,  0.80, 0.82, 0.78, 0.72, 0.80, 0.84),
  row('(mistral|magistral|codestral|devstral|ministral).*(small|mini|3b|8b)', 'Mistral small', 0.92, 0.60, 0.66, 0.58, 0.66, 0.76, 0.84),
  row('codestral|devstral',               'Mistral code',     0.80,  0.70, 0.84, 0.68, 0.56, 0.80, 0.78),
  row('mistral|magistral|mixtral',        'Mistral',          0.70,  0.78, 0.78, 0.76, 0.78, 0.82, 0.90),
  row('llama.*(405b|maverick|behemoth)',  'Llama large',      0.55,  0.80, 0.78, 0.76, 0.76, 0.82, 0.84),
  row('llama.*(8b|3b|1b|scout)',          'Llama small',      0.94,  0.52, 0.54, 0.46, 0.60, 0.70, 0.72),
  row('llama',                            'Llama',            0.78,  0.72, 0.72, 0.66, 0.72, 0.80, 0.80),
  row('gemma',                            'Gemma',            0.90,  0.58, 0.58, 0.54, 0.64, 0.74, 0.80),
  row('phi-',                             'Phi',              0.92,  0.62, 0.64, 0.66, 0.56, 0.72, 0.62),
  row('command',                          'Cohere Command',   0.72,  0.72, 0.66, 0.62, 0.76, 0.82, 0.88),
]

/**
 * What an unscored model gets. Every figure sits under every shipped row's
 * weakest general model, so an unknown model is never preferred over a known
 * one, and the router leaves a chat that is already on it alone unless a
 * known model clearly fits better.
 */
export const NEUTRAL: Omit<ScoreRow, 'pattern'> = {
  family: 'Unscored',
  speed: 0.5,
  scores: { reasoning: 0.45, coding: 0.45, math: 0.45, writing: 0.45, instructions: 0.45, multilingual: 0.45 },
}

/**
 * The free-tokens route answers with whichever free provider the engine finds
 * healthy, so it is scored as the middle of what those providers serve.
 */
export const FREE_TOKENS: Omit<ScoreRow, 'pattern'> = {
  family: 'Free tokens',
  speed: 0.7,
  scores: { reasoning: 0.68, coding: 0.70, math: 0.64, writing: 0.68, instructions: 0.78, multilingual: 0.78 },
}
