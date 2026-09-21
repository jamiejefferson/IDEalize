import { describe, expect, it } from 'vitest'
import { certificateIdentity, type SignContext } from '../scripts/sign-with-certificate.ts'

function context(appOutDir: string, electronPlatformName = 'darwin'): SignContext {
  return { appOutDir, electronPlatformName, packager: { appInfo: { productFilename: 'IDEalize V1' } } }
}

describe('sign-with-certificate', () => {
  it('keeps the ad-hoc seal when no identity is named', () => {
    expect(certificateIdentity(context('/out/mac-universal'), {})).toBeUndefined()
    expect(certificateIdentity(context('/out/mac-universal'), { IDEALIZE_MAC_SIGN_IDENTITY: ' ' })).toBeUndefined()
  })

  it('signs only the merged macOS app', () => {
    const env = { IDEALIZE_MAC_SIGN_IDENTITY: 'ABC123' }
    expect(certificateIdentity(context('/out/mac-universal'), env)).toBe('ABC123')
    expect(certificateIdentity(context('/out/mac-universal-x64-temp'), env)).toBeUndefined()
    expect(certificateIdentity(context('/out/win-unpacked', 'win32'), env)).toBeUndefined()
  })
})
