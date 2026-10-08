// Powell's voice rules: sentences leave for synthesis the moment they are
// complete, markers never reach the voice, the spoken budget holds, and an
// acknowledgement never claims an outcome before the work has happened.
import { describe, expect, it } from 'vitest'
import {
  ACK_LIBRARY, clipFor, isActionable, parseReply, pickAck, PRE_ACTION_ACKS, SentenceStream, tidy, wantsDetail,
} from '../src/speech-text.ts'

describe('SentenceStream', () => {
  it('releases a sentence as soon as the next character arrives', () => {
    const stream = new SentenceStream()
    expect(stream.push('Done.')).toEqual([])
    expect(stream.push(' It')).toEqual(['Done.'])
    expect(stream.push("'s in Paper.")).toEqual([])
    expect(stream.flush()).toEqual(["It's in Paper."])
  })

  it('does not cut on decimals or abbreviations', () => {
    const stream = new SentenceStream(5)
    expect(stream.push('Version 3.5 is out, e.g. today. Next')).toEqual(['Version 3.5 is out, e.g. today.'])
  })

  it('stops speaking at a marker line', () => {
    const stream = new SentenceStream()
    expect(stream.push('Idealize or JACQ?\n[choices: Idealize | JACQ]')).toEqual(['Idealize or JACQ?'])
    expect(stream.flush()).toEqual([])
  })

  it('keeps to the spoken budget', () => {
    const stream = new SentenceStream(2)
    const said = [...stream.push('One. Two. Three. Four. '), ...stream.flush()]
    expect(said).toEqual(['One.', 'Two.'])
  })

  it('strips markdown before speaking', () => {
    const stream = new SentenceStream()
    expect([...stream.push('**Saved** to `notes.md`. '), ...stream.flush()]).toEqual(['Saved to notes.md.'])
  })
})

describe('parseReply', () => {
  it('reads choices and an open target and removes them from the words', () => {
    const reply = parseReply('Which project?\n[choices: Idealize | JACQ | Hatch | Extra]')
    expect(reply).toEqual({ text: 'Which project?', choices: ['Idealize', 'JACQ', 'Hatch'] })
    expect(parseReply('Done. It is in the vault.\n[open: /tmp/note.md]')).toEqual({ text: 'Done. It is in the vault.', choices: [], open: '/tmp/note.md' })
  })

  it('tidies list markup', () => {
    expect(tidy('# Title\n- one\n- two')).toBe('Title one two')
  })
})

describe('acknowledgements', () => {
  it('offers only clips that claim no outcome before work runs', () => {
    for (const id of PRE_ACTION_ACKS) expect(['done', 'found-it', 'saved', 'updated']).not.toContain(id)
    for (let turn = 0; turn < 10; turn += 1) expect(PRE_ACTION_ACKS).toContain(pickAck(turn))
  })

  it('maps a spoken sentence to its cached clip', () => {
    expect(clipFor('Done.')).toBe('done')
    expect(clipFor('I’m listening')).toBe('listening')
    expect(clipFor('Done, and it is in Paper.')).toBeUndefined()
    expect(ACK_LIBRARY).toHaveLength(12)
    expect(clipFor('Updated.')).toBe('updated')
  })

  it('acknowledges instructions, not questions or chat', () => {
    expect(isActionable('Put the auth research into the Idealize docs')).toBe(true)
    expect(isActionable('What did we decide about voice?')).toBe(false)
    expect(isActionable('thanks Powell')).toBe(false)
    expect(isActionable('hi')).toBe(false)
  })

  it('relaxes the budget when asked to explain', () => {
    expect(wantsDetail('Explain the voice plan')).toBe(true)
    expect(wantsDetail('Open the plan')).toBe(false)
  })
})
