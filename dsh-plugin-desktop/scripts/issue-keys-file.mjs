/**
 * Write an IDEalize keys file from the keys in the environment, so an
 * organisation's keys never enter a repository. Run it where the keys are:
 *
 *   ANTHROPIC_API_KEY=… OPENROUTER_API_KEY=… FAL_KEY=… \
 *     node scripts/issue-keys-file.mjs "IDEalize Acme keys.idealizekeys" Acme
 *
 * Every `*_API_KEY` and `FAL_KEY` variable set in the environment goes in;
 * an empty environment is refused. The file is what `POST
 * /idealize/brains/services/import` reads; the issuer and date are notes for
 * whoever finds the file later and the app ignores them.
 */

import { writeFileSync } from 'node:fs'

const [, , output = 'IDEalize keys.idealizekeys', issuer = ''] = process.argv
const credentials = Object.fromEntries(Object.entries(process.env)
  .filter(([name, value]) => (name.endsWith('_API_KEY') || name === 'FAL_KEY') && (value ?? '').trim() !== '')
  .map(([name, value]) => [name, value.trim()])
  .sort(([left], [right]) => left.localeCompare(right)))

if (Object.keys(credentials).length === 0) {
  process.stderr.write('issue-keys-file: no *_API_KEY or FAL_KEY variable is set; nothing to write\n')
  process.exit(1)
}
if (!output.endsWith('.idealizekeys')) {
  process.stderr.write('issue-keys-file: the output name must end in .idealizekeys\n')
  process.exit(1)
}

const document = {
  format: 1,
  ...issuer === '' ? {} : { issuer },
  issued: new Date().toISOString().slice(0, 10),
  credentials,
}
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`issue-keys-file: wrote ${output} with ${Object.keys(credentials).join(', ')}\n`)
