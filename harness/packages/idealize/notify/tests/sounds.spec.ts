/**
 * The chime library over a fake machine: what each platform lists, the
 * once-only transcode on macOS, and the id fence that keeps a request from
 * naming a path. Plus the shared vocabulary the browser reads the catalogue
 * through, and the setting's default.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_CHIME, BUILT_IN_CHIME_SOUND, chimeSoundUrl, decodeChimeSounds } from '../src/chime-sounds.ts'
import { NotifySettingsSchema, type NotifySettings } from '../src/settings.ts'
import { createSoundLibrary, systemSoundSources, type SoundSources } from '../src/sounds.ts'

const CACHE = '/home/tester/.dsh/idealize/notify/sounds'

/** A machine with the given folders; every other folder is absent. */
function machine(platform: NodeJS.Platform, folders: Record<string, string[]>, options: {
  cached?: string[]
  sizes?: Record<string, number>
  refuse?: string[]
  env?: Record<string, string>
} = {}) {
  const transcoded: [string, string][] = []
  const made: string[] = []
  const sources: SoundSources = {
    platform,
    env: options.env ?? {},
    readdir: async (dir) => {
      const names = folders[dir]
      if (names === undefined) throw new Error(`ENOENT: ${dir}`)
      return names
    },
    size: async (path) => {
      const bytes = options.sizes?.[path]
      if (bytes === undefined) throw new Error(`ENOENT: ${path}`)
      return bytes
    },
    exists: async path => (options.cached ?? []).includes(path),
    mkdir: async (dir) => { made.push(dir) },
    transcode: async (input, output) => {
      if ((options.refuse ?? []).some(name => input.endsWith(name))) throw new Error(`afconvert refused ${input}`)
      transcoded.push([input, output])
    },
  }
  return { sources, transcoded, made }
}

describe('the chime library', () => {
  it('lists the built-in chime first, then the Mac\'s alert sounds by name, each transcoded once into the cache', async () => {
    const { sources, transcoded, made } = machine('darwin', {
      '/System/Library/Sounds': ['Ping.aiff', 'Glass.aiff', 'README.txt', 'Hero.aiff'],
    }, { cached: [join(CACHE, 'Hero.wav')] })
    const library = createSoundLibrary(CACHE, sources)
    expect(await library.list()).toEqual([
      BUILT_IN_CHIME,
      { id: 'system:Glass', label: 'Glass' },
      { id: 'system:Hero', label: 'Hero' },
      { id: 'system:Ping', label: 'Ping' },
    ])
    // Hero was already in the cache, so only the other two went through afconvert, into a folder made first.
    expect(transcoded).toEqual([
      ['/System/Library/Sounds/Ping.aiff', join(CACHE, 'Ping.wav')],
      ['/System/Library/Sounds/Glass.aiff', join(CACHE, 'Glass.wav')],
    ])
    expect(made).toEqual([CACHE, CACHE])
    expect(await library.file('system:Glass')).toEqual({ path: join(CACHE, 'Glass.wav'), contentType: 'audio/wav' })
    // The machine is read once: a second list runs nothing again.
    await library.list()
    expect(transcoded).toHaveLength(2)
  })

  it('leaves out a sound afconvert refuses, and lists nothing when the folder is not there', async () => {
    const refused = machine('darwin', { '/System/Library/Sounds': ['Glass.aiff', 'Odd.aiff'] }, { refuse: ['Odd.aiff'] })
    const library = createSoundLibrary(CACHE, refused.sources)
    expect((await library.list()).map(sound => sound.id)).toEqual([BUILT_IN_CHIME_SOUND, 'system:Glass'])
    expect(await library.file('system:Odd')).toBeUndefined()
    const bare = createSoundLibrary(CACHE, machine('darwin', {}).sources)
    expect(await bare.list()).toEqual([BUILT_IN_CHIME])
  })

  it('lists the short Windows alerts from the system Media folder, dropping the jingles and anything it cannot size', async () => {
    const media = join('D:\\Win', 'Media')
    const { sources } = machine('win32', {
      [media]: ['Windows Notify.wav', 'Windows Logon.wav', 'Windows Ding.wav', 'Ring01.wav', 'Windows Ghost.wav', 'Windows Print complete.wav'],
    }, {
      env: { SystemRoot: 'D:\\Win' },
      sizes: {
        [join(media, 'Windows Notify.wav')]: 120_000,
        [join(media, 'Windows Logon.wav')]: 2_400_000,
        [join(media, 'Windows Ding.wav')]: 80_000,
        [join(media, 'Windows Print complete.wav')]: 200_000,
      },
    })
    const library = createSoundLibrary(CACHE, sources)
    expect(await library.list()).toEqual([
      BUILT_IN_CHIME,
      { id: 'system:Windows Ding', label: 'Ding' },
      { id: 'system:Windows Notify', label: 'Notify' },
      { id: 'system:Windows Print complete', label: 'Print complete' },
    ])
    expect(await library.file('system:Windows Ding')).toEqual({ path: join(media, 'Windows Ding.wav'), contentType: 'audio/wav' })
    // Without SystemRoot the folder is the stock one.
    const stock = machine('win32', { [join('C:\\Windows', 'Media')]: ['Windows Pop.wav'] }, { sizes: { [join('C:\\Windows', 'Media', 'Windows Pop.wav')]: 10 } })
    expect((await createSoundLibrary(CACHE, stock.sources).list()).map(sound => sound.id)).toEqual([BUILT_IN_CHIME_SOUND, 'system:Windows Pop'])
  })

  it('lists the freedesktop stereo theme on Linux with readable names, and nothing on a platform it does not know', async () => {
    const { sources } = machine('linux', {
      '/usr/share/sounds/freedesktop/stereo': ['message-new-instant.oga', 'complete.oga', 'index.theme'],
    })
    expect(await createSoundLibrary(CACHE, sources).list()).toEqual([
      BUILT_IN_CHIME,
      { id: 'system:complete', label: 'Complete' },
      { id: 'system:message-new-instant', label: 'Message new instant' },
    ])
    expect(await createSoundLibrary(CACHE, sources).file('system:complete'))
      .toEqual({ path: '/usr/share/sounds/freedesktop/stereo/complete.oga', contentType: 'audio/ogg' })
    expect(await createSoundLibrary(CACHE, machine('freebsd', { '/System/Library/Sounds': ['Glass.aiff'] }).sources).list()).toEqual([BUILT_IN_CHIME])
  })

  it('serves a sound by catalogue id alone: a path, the built-in id or a stranger answers nothing', async () => {
    const { sources } = machine('darwin', { '/System/Library/Sounds': ['Glass.aiff'] })
    const library = createSoundLibrary(CACHE, sources)
    for (const id of ['../attention.json', '/System/Library/Sounds/Glass.aiff', 'Glass', 'system:Ping', BUILT_IN_CHIME_SOUND, '']) {
      expect(await library.file(id)).toBeUndefined()
    }
    expect(await library.file('system:Glass')).toBeDefined()
  })

  it('reads the real machine through the file system and afconvert', async () => {
    const real = systemSoundSources()
    expect(real.platform).toBe(process.platform)
    expect(await real.exists(import.meta.filename)).toBe(true)
    expect(await real.exists(join(import.meta.dirname, 'no-such-file'))).toBe(false)
    expect(await real.size(import.meta.filename)).toBeGreaterThan(0)
    expect(await real.readdir(import.meta.dirname)).toContain('sounds.spec.ts')
    // A folder that already exists is fine to make again.
    await expect(real.mkdir(import.meta.dirname)).resolves.toBeUndefined()
    // The converter itself is proven by hand on a Mac (see the commit); here it is only asked to refuse a missing input.
    await expect(real.transcode(join(import.meta.dirname, 'no-such.aiff'), join(import.meta.dirname, 'no-such.wav'))).rejects.toThrow()
  })
})

describe('the catalogue vocabulary', () => {
  it('maps the built-in chime to its asset route and every other id to the catalogue route', () => {
    expect(chimeSoundUrl(BUILT_IN_CHIME_SOUND)).toBe('/idealize/notify/chime.mp3')
    expect(chimeSoundUrl('system:Windows Ding')).toBe('/idealize/notify/sound?id=system%3AWindows%20Ding')
  })

  it('reads the host\'s answer, keeping the built-in chime first and dropping what is not an entry', () => {
    expect(decodeChimeSounds([
      { id: 'system:Glass', label: 'Glass' },
      { id: BUILT_IN_CHIME_SOUND, label: 'whatever the host called it' },
      { id: '', label: 'nameless' },
      { id: 'system:Ping' },
      null,
      'Hero',
    ])).toEqual([BUILT_IN_CHIME, { id: 'system:Glass', label: 'Glass' }])
    expect(decodeChimeSounds(undefined)).toEqual([BUILT_IN_CHIME])
    expect(decodeChimeSounds({ sounds: [] })).toEqual([BUILT_IN_CHIME])
  })

  it('defaults the setting to the built-in chime', () => {
    const stored = (value: Partial<NotifySettings>): NotifySettings => NotifySettingsSchema(value as NotifySettings)
    expect(stored({})).toMatchObject({ chimeSound: BUILT_IN_CHIME_SOUND, chimeEnabled: true, chimeVolume: 0.4 })
    expect(stored({ chimeSound: 'system:Glass' }).chimeSound).toBe('system:Glass')
  })
})
