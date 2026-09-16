/**
 * Regenerate `src/client/owl-clips.ts` from the source WebM clips (transparent
 * background, 24fps, 720×544 — the APNGs beside them are deliberately NOT
 * inlined). The sources live outside the repo; pass their directory:
 *
 *   pnpm tsx scripts/gen-owl-clips.ts "/path/to/OnboardingOwls/transparent"
 *
 * The clips inline as data URIs (the splash-frames precedent): the client
 * bundle carries them with no loader change.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Wizard step → source clip file name. */
const CLIPS: Record<string, string> = {
  agents: 'Owl-onboard-agent.webm',
  tools: 'owl-onboard-tools.webm',
  'projects-folder': 'owl-onboard-projects.webm',
  'documentation-folder': 'owl-onboard-documentation.webm',
  finish: 'owl-onboard-complete.webm',
}

/**
 * Steps that reuse another step's clip: the skills folder step (JJ, 15 Sep
 * 2026) has no owl of its own yet and shows the documentation owl.
 */
const SHARED: Record<string, string> = {
  'skills-folder': 'documentation-folder',
}

const sourceDir = process.argv[2]
if (sourceDir === undefined || sourceDir === '') {
  console.error('usage: pnpm tsx scripts/gen-owl-clips.ts <OnboardingOwls/transparent dir>')
  process.exit(1)
}

const entries = Object.entries(CLIPS).map(([step, file]) => {
  const base64 = readFileSync(join(sourceDir, file)).toString('base64')
  return `  '${step}': 'data:video/webm;base64,${base64}',`
})
const shared = Object.entries(SHARED).map(([step, from]) => `  '${step}': CLIPS['${from}'],`)

const out = fileURLToPath(new URL('../src/client/owl-clips.ts', import.meta.url))
writeFileSync(out, `/**
 * The per-step owl clips (transparent WebM, 24fps, 720×544), inlined as data
 * URIs so the client bundle carries them without a loader change. GENERATED
 * by scripts/gen-owl-clips.ts from sources outside the repo — do not edit by
 * hand; regenerate with:
 *
 *   pnpm tsx scripts/gen-owl-clips.ts "<OnboardingOwls/transparent dir>"
 */
import type { OnboardingStepId } from './steps.ts'

/** The clips drawn for the wizard, one per source file. */
const CLIPS = {
${entries.join('\n')}
} as const

/** The clip for each wizard step, keyed for OwlArt's per-step hook. */
export const OWL_CLIPS: Record<OnboardingStepId, string> = {
  ...CLIPS,
${shared.join('\n')}
}
`)
console.log(`gen-owl-clips: wrote ${out}`)
