// Host paths in the browser: a Windows host writes backslashes and a drive
// letter, so joins keep the host's separator and comparisons accept either
// separator and ignore case on Windows.
import { describe, expect, it } from 'vitest'
import { fileManagerKey, isAtOrBeneath, isBeneath, joinHostPath, separatorOf } from '../src/client/host-path.ts'

describe('joinHostPath', () => {
  it('joins with the parent\'s own separator', () => {
    expect(joinHostPath('/w/proj', 'src')).toBe('/w/proj/src')
    expect(joinHostPath('C:\\w\\proj', 'src')).toBe('C:\\w\\proj\\src')
    expect(joinHostPath('C:\\', 'w')).toBe('C:\\w')
    expect(joinHostPath('\\\\server\\share', 'a')).toBe('\\\\server\\share\\a')
  })

  it('turns a relative storage path into the host\'s form', () => {
    expect(joinHostPath('C:\\w\\proj', 'Images/a.png')).toBe('C:\\w\\proj\\Images\\a.png')
    expect(joinHostPath('/w/proj', 'Images/a.png')).toBe('/w/proj/Images/a.png')
  })

  it('reads a drive path written with forward slashes as Windows', () => {
    expect(separatorOf('C:/w/proj')).toBe('\\')
  })
})

describe('isBeneath and isAtOrBeneath', () => {
  it('matches a Windows path whatever its separator or case', () => {
    expect(isBeneath('C:\\Users\\jj\\proj', 'C:\\Users\\jj\\proj\\src\\a.ts')).toBe(true)
    expect(isBeneath('C:\\Users\\jj\\proj', 'c:\\users\\JJ\\proj\\src')).toBe(true)
    expect(isBeneath('C:\\Users\\jj\\proj', 'C:/Users/jj/proj/src')).toBe(true)
    expect(isAtOrBeneath('C:\\Users\\jj\\proj', 'c:\\users\\jj\\proj')).toBe(true)
    expect(isBeneath('C:\\Users\\jj\\proj', 'C:\\Users\\jj\\proj')).toBe(false)
  })

  it('keeps a sibling with the same prefix out', () => {
    expect(isAtOrBeneath('C:\\w\\a', 'C:\\w\\ab')).toBe(false)
    expect(isAtOrBeneath('/w/a', '/w/ab')).toBe(false)
  })

  it('keeps case on a Mac path', () => {
    expect(isBeneath('/w/proj', '/w/proj/src')).toBe(true)
    expect(isBeneath('/w/proj', '/W/proj/src')).toBe(false)
  })
})

describe('fileManagerKey', () => {
  it('names Explorer and the Recycle Bin on Windows, Finder and the Trash elsewhere', () => {
    expect(fileManagerKey('files.reveal', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('files.reveal.windows')
    expect(fileManagerKey('files.trash', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('files.trash')
  })
})
