/**
 * The Client half of the generate_image turn: the `artefact/created` payload
 * the assembled snapshot run committed (`generation-snapshots/fixture-image/`)
 * folds through the artefact Definition into one visible chat node. Reading
 * the same committed payload the assembled run pins keeps this proof anchored
 * to a real generation rather than a hand-written event.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import { artefactDefinition } from '@idealize/artefacts/client'
import type { ArtefactChatData } from '@idealize/artefacts/client'

const eventExpected = fileURLToPath(new URL('./generation-snapshots/fixture-image/artefact-created.event.json', import.meta.url))

describe('the generated artefact in the transcript', () => {
  it('folds the assembled run\'s artefact/created into a visible chat node', async () => {
    const record = JSON.parse(await readFile(eventExpected, 'utf8')) as { id: string; mediaType: string; storage: { bytes: number; relPath: string } }
    const event = { type: 'artefact/created', seq: 12, time: 0, data: { record } } as unknown as SessionEvent

    const matched = artefactDefinition.match(event)
    if (matched === null) throw new Error('the artefact Definition did not match its own event')
    expect(matched.id).toBe(record.id)

    const match = { event, role: matched.role, location: { kind: 'unresolved' } } as unknown as ConversationMatch
    const base = {
      key: `12:artefact${matched.id}`,
      kind: 'artefact',
      id: matched.id,
      matches: [match],
      start: match,
      state: undefined,
      current: new Map(),
    } as unknown as ConversationNodeContext<ArtefactChatData>
    const state = artefactDefinition.start(base, match, { previous: () => undefined })
    expect(state).toEqual({
      status: 'created',
      id: record.id,
      mediaType: 'image/png',
      bytes: record.storage.bytes,
      relPath: record.storage.relPath,
    })

    const node = artefactDefinition.buildViewNode?.({ ...base, state })
    expect(node).toMatchObject({ kind: 'artefact', target: 'chat', visibility: 'visible', anchorSeq: 12 })
  })
})
