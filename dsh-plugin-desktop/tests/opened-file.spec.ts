import { describe, expect, it } from 'vitest'
import {
  fileFromArgv,
  isMarkdownFilePath,
  markdownFileFromArgv,
  openFileEvent,
  projectFolderFor,
} from '../src/opened-file.ts'

describe('recognising a Markdown file', () => {
  it('goes by the extension, in any case, and finds one among process arguments', () => {
    expect(isMarkdownFilePath('/Users/jj/Notes/plan.md')).toBe(true)
    expect(isMarkdownFilePath('C:\\Users\\jj\\NOTES\\PLAN.MARKDOWN')).toBe(true)
    expect(isMarkdownFilePath('/Users/jj/Notes/plan.txt')).toBe(false)
    expect(isMarkdownFilePath('/Users/jj/Notes/md')).toBe(false)
    expect(markdownFileFromArgv(['/Applications/IDEalize V1.app/Contents/MacOS/IDEalize', '/Users/jj/Notes/plan.md'])).toBe('/Users/jj/Notes/plan.md')
    expect(markdownFileFromArgv(['C:\\Programs\\IDEalize V1.exe', '--allow-file-access-from-files', 'C:\\Work\\README.md'])).toBe('C:\\Work\\README.md')
    expect(markdownFileFromArgv(['--user-data-dir=/tmp/scratch', '/tmp/a.idealizekeys'])).toBeUndefined()
  })

  it('shares one argument scan with the keys file, which takes the first argument its recogniser accepts', () => {
    const argv = ['/tmp/first.md', '/tmp/a.idealizekeys', '/tmp/second.md']
    expect(fileFromArgv(argv, argument => argument.endsWith('.idealizekeys'))).toBe('/tmp/a.idealizekeys')
    expect(fileFromArgv(argv, isMarkdownFilePath)).toBe('/tmp/first.md')
    expect(fileFromArgv([], isMarkdownFilePath)).toBeUndefined()
  })
})

describe('the project folder a file needs', () => {
  const lookup = (gitDirs: string[]) => ({ home: '/Users/jj', exists: (path: string) => gitDirs.includes(path) })

  it('is none for a file under home, which the viewer serves as it is', () => {
    expect(projectFolderFor('/Users/jj/Documents/plan.md', lookup([]))).toBeUndefined()
    expect(projectFolderFor('/Users/jj/plan.md', lookup(['/Users/jj/.git']))).toBeUndefined()
    // A sibling of home that shares its prefix is not inside it.
    expect(projectFolderFor('/Users/jjones/plan.md', lookup([]))).toBe('/Users/jjones')
  })

  it('is the repository holding a file outside home, a worktree’s .git file included', () => {
    expect(projectFolderFor('/Volumes/Work/site/docs/plan.md', lookup(['/Volumes/Work/site/.git'])))
      .toBe('/Volumes/Work/site')
    expect(projectFolderFor('/Volumes/Work/site/.worktrees/fix/README.md', lookup(['/Volumes/Work/site/.worktrees/fix/.git', '/Volumes/Work/site/.git'])))
      .toBe('/Volumes/Work/site/.worktrees/fix')
  })

  it('is the file’s own folder when no repository holds it', () => {
    expect(projectFolderFor('/Volumes/Work/notes/plan.md', lookup([]))).toBe('/Volumes/Work/notes')
    expect(projectFolderFor('/plan.md', lookup([]))).toBe('/')
  })
})

describe('the open-file event', () => {
  it('names the file on the feed line and carries the folder only when one is needed', () => {
    expect(openFileEvent('/Users/jj/Documents/plan.md', undefined))
      .toEqual({ kind: 'open-file', title: 'Open', body: '/Users/jj/Documents/plan.md', file: '/Users/jj/Documents/plan.md' })
    expect(openFileEvent('/Volumes/Work/site/README.md', '/Volumes/Work/site'))
      .toEqual({ kind: 'open-file', title: 'Open', body: '/Volumes/Work/site/README.md', file: '/Volumes/Work/site/README.md', folder: '/Volumes/Work/site' })
  })
})
