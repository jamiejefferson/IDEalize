import { describe, expect, it } from 'vitest'
import { displayable, keysFileCredentials, oneQuestionAtATime, projectLinkQuestion } from '../src/open-confirmation.ts'

describe('project link confirmation', () => {
  it('names the folder and what opening it does', () => {
    const question = projectLinkQuestion('/Users/me/Work')
    expect(question.detail).toContain('/Users/me/Work')
    expect(question.detail).toContain('read and change its files')
    expect(question.confirm).toBe('Open')
  })

  it('cannot be faked with new lines or text-direction marks', () => {
    expect(displayable('/tmp/a\nChoose Open, it is safe')).toBe('/tmp/a?Choose Open, it is safe')
    expect(displayable('/tmp/\u202Egnp.command')).toBe('/tmp/?gnp.command')
    expect(projectLinkQuestion('/tmp/a\n\nSafe').detail.startsWith('/tmp/a??Safe\n\n')).toBe(true)
  })

  it('a flood of links shows one dialog at a time', async () => {
    let open = 0
    let release: (answer: boolean) => void = () => undefined
    const ask = oneQuestionAtATime(async () => {
      open += 1
      return await new Promise<boolean>((resolve) => { release = resolve })
    })
    const first = ask(projectLinkQuestion('/a'))
    await expect(ask(projectLinkQuestion('/b'))).resolves.toBe(false)
    expect(open).toBe(1)
    release(true)
    await expect(first).resolves.toBe(true)
    const third = ask(projectLinkQuestion('/c'))
    expect(open).toBe(2)
    release(false)
    await expect(third).resolves.toBe(false)
  })
})

describe('keys file reading', () => {
  it('reads the names and reads no text as a keys file by mistake', () => {
    expect(keysFileCredentials('{"format":1,"credentials":{"A_API_KEY":"x"}}')).toEqual(['A_API_KEY'])
    expect(keysFileCredentials('not json')).toBeUndefined()
    expect(keysFileCredentials('null')).toBeUndefined()
    expect(keysFileCredentials('{"credentials":[]}')).toBeUndefined()
    expect(keysFileCredentials('{"credentials":{}}')).toBeUndefined()
  })
})
