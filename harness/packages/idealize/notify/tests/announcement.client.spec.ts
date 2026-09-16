import { describe, expect, it } from 'vitest'
import { compareVersions, decodeAnnouncement, selectAnnouncement, versionInRange } from '../src/announcement.ts'

const row = {
  id: 'a1',
  title: 'v0.1.1 is ready',
  body: 'Your feedback fixed three things.',
  cta_label: 'Download',
  cta_url: 'https://example.test/dl',
  min_app_version: '0.1.0',
  max_app_version: '0.1.0',
  active: true,
}

describe('version comparison (V0 SemVer rules)', () => {
  it('reads missing components as zero', () => {
    expect(compareVersions('0.1', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.1', '0.1')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-dev', '1.0.0')).toBe(0)
  })
  it('fails open without a readable app version', () => {
    expect(versionInRange(undefined, '0.1.0', '0.2.0')).toBe(true)
    expect(versionInRange('', '0.1.0', '0.2.0')).toBe(true)
  })
  it('holds back versions outside [min, max]', () => {
    expect(versionInRange('0.0.9', '0.1.0', undefined)).toBe(false)
    expect(versionInRange('0.2.0', undefined, '0.1.5')).toBe(false)
    expect(versionInRange('0.1.2', '0.1.0', '0.1.5')).toBe(true)
  })
})

describe('announcement selection', () => {
  it('decodes the REST row with snake_case optionals', () => {
    expect(decodeAnnouncement(row)).toEqual({
      id: 'a1',
      title: row.title,
      body: row.body,
      ctaLabel: 'Download',
      ctaUrl: 'https://example.test/dl',
      minAppVersion: '0.1.0',
      maxAppVersion: '0.1.0',
    })
    expect(decodeAnnouncement({ title: 'x' })).toBeUndefined()
  })
  it('shows the newest row once per id and gates on max_app_version', () => {
    expect(selectAnnouncement([row], '0.1.0', '')?.id).toBe('a1')
    expect(selectAnnouncement([row], '0.1.0', 'a1')).toBeUndefined()
    expect(selectAnnouncement([row], '0.1.1', '')).toBeUndefined()
    expect(selectAnnouncement([row], undefined, '')?.id).toBe('a1')
    expect(selectAnnouncement([], '0.1.0', '')).toBeUndefined()
    expect(selectAnnouncement({ error: 'x' }, '0.1.0', '')).toBeUndefined()
  })

  it('leaves out an optional field the row does not carry, or carries empty', () => {
    const decoded = decodeAnnouncement({ id: 'a-1', title: 'New build', body: 'Reopen to get it', cta_label: '' })
    expect(decoded).toEqual({ id: 'a-1', title: 'New build', body: 'Reopen to get it' })
  })
})
