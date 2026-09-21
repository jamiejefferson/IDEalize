import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseIdealizeUrl, parseProjectSwitch, requestFromArgv } from '../src/idealize-url.ts'
import { installFinderQuickAction, QUICK_ACTION_NAME } from '../src/finder-quick-action.ts'

describe('the idealize:// scheme', () => {
  it('reads the folder out of a project request', () => {
    expect(parseIdealizeUrl('idealize://project?path=%2FUsers%2Fjj%2FNotes'))
      .toEqual({ kind: 'open-project', path: '/Users/jj/Notes' })
  })

  it('keeps the characters a shell would have eaten', () => {
    const path = '/Users/jj/Art & Design #2/what?'
    expect(parseIdealizeUrl(`idealize://project?path=${encodeURIComponent(path)}`))
      .toEqual({ kind: 'open-project', path })
  })

  it('takes a Windows drive path', () => {
    expect(parseIdealizeUrl('idealize://project?path=C%3A%5CWork%5CVault')?.path).toBe('C:\\Work\\Vault')
  })

  it('refuses another scheme, another request, and a relative path', () => {
    expect(parseIdealizeUrl('claude://project?path=%2Ftmp')).toBeUndefined()
    expect(parseIdealizeUrl('idealize://run?path=%2Ftmp')).toBeUndefined()
    expect(parseIdealizeUrl('idealize://project?path=..%2F..%2Fetc')).toBeUndefined()
    expect(parseIdealizeUrl('idealize://project')).toBeUndefined()
    expect(parseIdealizeUrl('not a url at all')).toBeUndefined()
  })

  it('finds the request among process arguments and reports none when there is none', () => {
    expect(requestFromArgv(['/Applications/IDEalize V1.app/Contents/MacOS/IDEalize', 'idealize://project?path=%2Ftmp%2Fv']))
      .toEqual({ kind: 'open-project', path: '/tmp/v' })
    expect(requestFromArgv(['--user-data-dir=/tmp/scratch'])).toBeUndefined()
  })
})

describe('the Explorer switch', () => {
  it('reads the folder Explorer substituted for %V, characters a URL would have eaten included', () => {
    expect(parseProjectSwitch('--idealize-project=C:\\Work\\Art & Design #2 100%25'))
      .toEqual({ kind: 'open-project', path: 'C:\\Work\\Art & Design #2 100%25' })
  })

  it('restores the backslash a drive root loses to the closing quote', () => {
    expect(parseProjectSwitch('--idealize-project=D:"')?.path).toBe('D:\\')
  })

  it('refuses a relative path, an empty one, and any other switch', () => {
    expect(parseProjectSwitch('--idealize-project=Work\\Vault')).toBeUndefined()
    expect(parseProjectSwitch('--idealize-project=')).toBeUndefined()
    expect(parseProjectSwitch('--user-data-dir=C:\\scratch')).toBeUndefined()
  })

  it('is found among the arguments of a first launch and of a second instance', () => {
    expect(requestFromArgv(['C:\\Programs\\IDEalize V1.exe', '--allow-file-access-from-files', '--idealize-project=C:\\Work\\Vault']))
      .toEqual({ kind: 'open-project', path: 'C:\\Work\\Vault' })
  })
})

describe('the Finder Quick Action', () => {
  it('writes a workflow that sends the selected folder over the scheme', async () => {
    const services = await mkdtemp(join(tmpdir(), 'idealize-services-'))

    expect(await installFinderQuickAction(services)).toBe('written')

    const contents = join(services, `${QUICK_ACTION_NAME}.workflow`, 'Contents')
    const info = await readFile(join(contents, 'Info.plist'), 'utf8')
    expect(info).toContain('<string>Idealize this</string>')
    expect(info).toContain('runWorkflowAsService')
    const workflow = await readFile(join(contents, 'document.wflow'), 'utf8')
    // Folders in Finder, as arguments, into one `open idealize://project` line.
    expect(workflow).toContain('com.apple.Automator.fileSystemObject.folder')
    expect(workflow).toContain('com.apple.finder')
    expect(workflow).toContain('open "idealize://project?path=$u"')
    expect(workflow).toContain('<key>inputMethod</key>\n\t\t\t\t\t<integer>1</integer>')
  })

  it('leaves an install that already matches alone and repairs one that does not', async () => {
    const services = await mkdtemp(join(tmpdir(), 'idealize-services-'))
    await installFinderQuickAction(services)

    expect(await installFinderQuickAction(services)).toBe('unchanged')

    const contents = join(services, `${QUICK_ACTION_NAME}.workflow`, 'Contents')
    await writeFile(join(contents, 'document.wflow'), 'someone edited this')
    expect(await installFinderQuickAction(services)).toBe('written')
    expect(await readFile(join(contents, 'document.wflow'), 'utf8')).toContain('RunShellScriptAction')
  })

  it('creates the Services directory when the user has none', async () => {
    const home = await mkdtemp(join(tmpdir(), 'idealize-home-'))
    const services = join(home, 'Library', 'Services')

    expect(await installFinderQuickAction(services)).toBe('written')

    await mkdir(services, { recursive: true })
    expect(await readFile(join(services, `${QUICK_ACTION_NAME}.workflow`, 'Contents', 'Info.plist'), 'utf8')).toContain('NSServices')
  })
})
