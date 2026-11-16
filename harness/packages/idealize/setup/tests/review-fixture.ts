// A small documentation folder with one planted case for each thing the
// weekly review fixes, flags or must leave alone. The spec builds it in a
// scratch folder; run this file to build it by hand for a review against a
// real model:
//
//   corepack pnpm exec tsx packages/idealize/setup/tests/review-fixture.ts <empty folder>
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What the fixture plants, by path relative to the folder. */
export const PLANTED = {
  /** A project index of about 10,000 characters, over the 6,000 limit: flagged `index-oversize`. */
  oversizeIndex: 'Projects/Lighthouse/_index.md',
  /** A note with no frontmatter that its project index does not link: fixed. */
  bareNote: 'Projects/Lighthouse/2026-11-12-harbour-brief.md',
  /** A note past its `stale_after` date: flagged `stale`. */
  staleNote: 'Reference/pricing.md',
  /** A note whose `type` and `status` are outside the documented lists: left as it is, and flagged. */
  listingNote: 'Reference/listings/harbour-flat.md',
  /** A note with no `description`: flagged. */
  undescribedNote: 'Reference/glossary.md',
  /** Two learnings for one skill: flagged as a skill with new learnings. */
  learnings: 'Reference/playbook-learnings/brief-writer.md',
  /** A person note the bare note names: linked. */
  person: 'People/alex-morgan.md',
  /** A note in the default never-edit folder: read, never changed. */
  neverEdit: 'sessions/2026-11-13-chat.md',
  /** A note in a folder the spec lists as skipped. */
  skipped: 'Archive/2019-plan.md',
} as const

const DAY_MS = 24 * 3_600_000

/** An ISO date `days` before `now`. */
function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Write the fixture into one folder.
 * @param folder - an empty or missing folder.
 * @param now - the day the review is taken to run on.
 */
export async function writeReviewFixture(folder: string, now = new Date()): Promise<void> {
  const decisions = Array.from({ length: 66 }, (_unused, index) => (
    `### 2026-0${String(1 + index % 9)}-1${String(index % 10)} — Decision ${String(index + 1)}\n`
    + 'Chose the simpler of the two options after a short trial, and wrote down what it cost so the choice can be revisited.\n'
  )).join('\n')
  const files: Record<string, string> = {
    [PLANTED.oversizeIndex]: [
      '---', 'project: lighthouse', 'status: active', 'type: index', 'created: 2026-01-15', `last_touched: ${daysBefore(now, 2)}`, 'tags: []', '---',
      '# Lighthouse', '', '## State', 'The harbour listing page is in review.', '', '## Notes', '- [[Projects/Lighthouse/2026-10-02-kickoff]]', '',
      '## Decisions', decisions,
    ].join('\n'),
    'Projects/Lighthouse/2026-10-02-kickoff.md': [
      '---', 'project: lighthouse', 'type: note', 'created: 2026-10-02', 'tags: []', 'description: Kickoff notes for Lighthouse.', '---',
      '# Kickoff', '', 'Agreed the first milestone.',
    ].join('\n'),
    [PLANTED.bareNote]: '# Harbour brief\n\nAlex Morgan asked for a one-page brief on the harbour flat for Lighthouse.\n',
    [PLANTED.staleNote]: [
      '---', 'type: reference', 'created: 2026-03-01', 'tags: [pricing]', 'description: Price list agreed in March.',
      `stale_after: ${daysBefore(now, 30)}T00:00:00Z`, '---', '# Pricing', '', 'Day rate and package prices.',
    ].join('\n'),
    [PLANTED.listingNote]: [
      '---', 'type: listing', 'status: shortlist', `created: ${daysBefore(now, 3)}`, 'tags: []', 'description: Two-bed flat by the harbour.', '---',
      '# Harbour flat', '', 'Viewed once. Worth a second visit.',
    ].join('\n'),
    [PLANTED.undescribedNote]: ['---', 'type: reference', `created: ${daysBefore(now, 1)}`, 'tags: []', '---', '# Glossary', '', 'Terms used across projects.'].join('\n'),
    [PLANTED.learnings]: [
      '---', 'type: log', 'created: 2026-11-01', 'tags: []', '---', '# brief-writer learnings', '',
      '- 2026-10-01 (builder/model-a): The template link in step 2 is dead.',
      `- ${daysBefore(now, 2)} (builder/model-a): Step 4 asks for a word count the template no longer has.`,
      `- ${daysBefore(now, 1)} (planner/model-b): The brief needs the client name before the summary.`,
    ].join('\n'),
    [PLANTED.person]: ['---', 'type: person', 'created: 2026-02-01', 'tags: []', 'description: Client lead for Lighthouse.', '---', '# Alex Morgan'].join('\n'),
    [PLANTED.neverEdit]: `# Chat on ${daysBefore(now, 3)}\n\nA transcript with no frontmatter. The review reads it and never changes it.\n`,
    [PLANTED.skipped]: '# 2019 plan\n\nAn old plan with no frontmatter, in a folder the review is told to skip.\n',
  }
  for (const [path, text] of Object.entries(files)) {
    const target = join(folder, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text.endsWith('\n') ? text : `${text}\n`)
  }
  // Two notes last changed before the review's 7-day window: the stale one and the kickoff.
  const old = new Date(now.getTime() - 60 * DAY_MS)
  for (const path of [PLANTED.staleNote, 'Projects/Lighthouse/2026-10-02-kickoff.md', PLANTED.person]) await utimes(join(folder, path), old, old)
}

/* v8 ignore start -- the hand-run entry; the spec calls writeReviewFixture directly. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: review-fixture.ts <empty folder>')
  await writeReviewFixture(resolve(folder))
  console.log(`Wrote the review fixture to ${resolve(folder)}`)
}
/* v8 ignore stop */
