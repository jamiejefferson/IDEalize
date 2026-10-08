import { describe, expect, it } from 'vitest'
import { namesAChat, PromptLines } from '../src/client/prompt-line.ts'

describe('PromptLines', () => {
  it('reads lines back out of keystrokes: Backspace, Ctrl-U and escape sequences included', () => {
    const lines = new PromptLines()
    expect(lines.push('get kitchen quot')).toEqual([])
    expect(lines.push('ex\u007F\u007Fes\u001B[A')).toEqual([])
    expect(lines.push(' for the flat\r')).toEqual(['get kitchen quotes for the flat'])
    expect(lines.push('nonsense\u0015ls\r\r')).toEqual(['ls'])
    expect(lines.push('\u001B[200~pasted words here\u001B[201~\r')).toEqual(['pasted words here'])
  })

  it('names a chat only from a prompt of three words or more that is not a slash command', () => {
    expect(namesAChat('ls -la')).toBe(false)
    expect(namesAChat('/model opus please')).toBe(false)
    expect(namesAChat('get kitchen quotes')).toBe(true)
  })
})
