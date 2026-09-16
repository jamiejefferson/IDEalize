/**
 * What a login flow surfaces becomes the page the browser opens: browser
 * flows raise an authorize URL, device-code flows a verification page with a
 * code, and the sign-in page shows the code while such a login is pending.
 */
import { describe, expect, it } from 'vitest'
import { noteAuthEvent } from '../src/index.ts'
import type { PendingLogin } from '../src/index.ts'
import { signinPage } from '../src/signin-page.ts'

function attempt(): PendingLogin {
  return { done: false, settled: Promise.resolve() }
}

describe('noteAuthEvent', () => {
  it('settles the authorize URL a browser flow raises', () => {
    const record = attempt()
    expect(noteAuthEvent(record, { type: 'auth_url', url: 'https://auth.example/authorize?x=1' })).toBe('https://auth.example/authorize?x=1')
    expect(record).toMatchObject({ authUrl: 'https://auth.example/authorize?x=1' })
    expect(record.userCode).toBeUndefined()
  })

  it('settles the verification page a device-code flow raises and keeps the code beside it', () => {
    const record = attempt()
    const url = noteAuthEvent(record, {
      type: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.kimi.com/device?user_code=ABCD-1234',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    })
    expect(url).toBe('https://auth.kimi.com/device?user_code=ABCD-1234')
    expect(record).toMatchObject({ authUrl: 'https://auth.kimi.com/device?user_code=ABCD-1234', userCode: 'ABCD-1234' })
  })

  it('leaves the attempt alone for progress and info events', () => {
    const record = attempt()
    expect(noteAuthEvent(record, { type: 'progress', message: 'polling' })).toBeUndefined()
    expect(noteAuthEvent(record, { type: 'info', message: 'hello' })).toBeUndefined()
    expect(record.authUrl).toBeUndefined()
  })
})

describe('the sign-in page', () => {
  it('shows a pending device code and polls for the device flow\'s whole expiry', () => {
    const html = signinPage()
    expect(html).toContain('provider.pending && provider.userCode')
    expect(html).toContain('If the page asks for a code, enter ')
    expect(html).toContain('for (let i = 0; i < 450; i++)')
  })
})
