import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleProjectLook, ProjectLooks, sniffImage } from '../src/project-look.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')

let root: string
let data: string
let project: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'project-look-'))
  data = join(root, 'data')
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function looksFor(projects: { id: string; path: string }[], now = () => 0): ProjectLooks {
  return new ProjectLooks(data, { list: () => projects }, now)
}

describe('project look', () => {
  it('keeps an accent and a chosen image across a restart', async () => {
    const looks = looksFor([{ id: 'w1', path: project }])
    expect(await looks.update('w1', { accent: '#3E63DD' })).toBe(true)
    expect(await looks.storeImage('w1', PNG)).toBe('ok')

    const again = looksFor([{ id: 'w1', path: project }])
    const view = (await again.list()).w1
    expect(view?.accent).toBe('#3e63dd')
    expect(view?.logo).toBe('custom')
    expect(view?.iconUrl).toMatch(/^\/idealize\/project-look\/icon\/w1\?v=/)
    const stored = await readdir(join(data, 'project-look'))
    expect(stored).toHaveLength(1)
  })

  it('reads a damaged or old file as no looks', async () => {
    await mkdir(data, { recursive: true })
    await writeFile(join(data, 'project-look.json'), '{"projects":{"w1":{"accent":"red","logo":"custom","image":"../x"}}')
    expect((await looksFor([{ id: 'w1', path: project }]).list()).w1).toEqual({ accent: null, logo: 'auto', iconUrl: null })

    await writeFile(join(data, 'project-look.json'), '{"projects":{"w1":{"accent":"red","logo":"custom","image":"../x"}}}')
    expect((await looksFor([{ id: 'w1', path: project }]).list()).w1).toEqual({ accent: null, logo: 'auto', iconUrl: null })
  })

  it('finds the first obvious logo in the project folder', async () => {
    await mkdir(join(project, 'public'), { recursive: true })
    await writeFile(join(project, 'public', 'logo.png'), PNG)
    await writeFile(join(project, 'public', 'favicon.svg'), SVG)
    const looks = looksFor([{ id: 'w1', path: project }])
    expect(await looks.logoFile('w1')).toMatch(/public\/favicon\.svg$/)
  })

  it('skips empty, oversized and escaping logo files', async () => {
    await writeFile(join(project, 'favicon.svg'), '')
    await writeFile(join(project, 'favicon.png'), Buffer.alloc(600 * 1024))
    await writeFile(join(root, 'outside.png'), PNG)
    await symlink(join(root, 'outside.png'), join(project, 'logo.png'))
    await writeFile(join(project, 'icon.png'), PNG)
    expect(await looksFor([{ id: 'w1', path: project }]).logoFile('w1')).toMatch(/icon\.png$/)
  })

  it('caches the folder scan for a minute', async () => {
    let clock = 0
    const looks = looksFor([{ id: 'w1', path: project }], () => clock)
    expect(await looks.logoFile('w1')).toBeUndefined()
    await writeFile(join(project, 'logo.svg'), SVG)
    clock = 30_000
    expect(await looks.logoFile('w1')).toBeUndefined()
    clock = 61_000
    expect(await looks.logoFile('w1')).toMatch(/logo\.svg$/)
  })

  it('turns the logo off, and back to automatic, and drops a stored image', async () => {
    await writeFile(join(project, 'logo.svg'), SVG)
    const looks = looksFor([{ id: 'w1', path: project }])
    await looks.storeImage('w1', PNG)
    await looks.update('w1', { logo: 'none' })
    expect((await looks.list()).w1?.iconUrl).toBeNull()
    expect(await readdir(join(data, 'project-look'))).toEqual([])
    await looks.update('w1', { logo: 'auto', accent: null })
    expect((await looks.list()).w1).toMatchObject({ logo: 'auto', accent: null })
    expect((await looks.list()).w1?.iconUrl).not.toBeNull()
    const file = JSON.parse(await readFile(join(data, 'project-look.json'), 'utf8')) as unknown
    expect(file).toEqual({ version: 1, projects: { w1: {} } })
  })

  it('refuses unknown projects, large files and non-images', async () => {
    const looks = looksFor([{ id: 'w1', path: project }])
    expect(await looks.update('nope', { accent: '#000000' })).toBe(false)
    expect(await looks.storeImage('nope', PNG)).toBe('no-project')
    expect(await looks.storeImage('w1', Buffer.alloc(600 * 1024))).toBe('too-large')
    expect(await looks.storeImage('w1', Buffer.from('<html><script>alert(1)</script>'))).toBe('not-an-image')
  })

  it('recognises each accepted image type by its bytes', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('gif')
    expect(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0]))).toBe('ico')
    expect(sniffImage(SVG)).toBe('svg')
    expect(sniffImage(Buffer.from('hello'))).toBeUndefined()
  })
})

describe('project look route', () => {
  it('lists, saves, stores and serves a logo, refusing bad input', async () => {
    const looks = looksFor([{ id: 'w1', path: project }])
    const refused: boolean[] = []
    const server = createServer((req, res) => {
      void handleProjectLook(looks, req, res, (_req, _res, mutating) => { refused.push(mutating === true); return false })
    })
    await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done) })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/idealize/project-look`
    try {
      expect(await (await fetch(base)).json()).toEqual({ items: { w1: { accent: null, logo: 'auto', iconUrl: null } } })
      expect((await fetch(`${base}/w1`, { method: 'POST', body: '{"accent":"red"}' })).status).toBe(400)
      expect((await fetch(`${base}/w1`, { method: 'POST', body: '{"logo":"custom"}' })).status).toBe(400)
      expect((await fetch(`${base}/nope`, { method: 'POST', body: '{"accent":"#000000"}' })).status).toBe(404)
      expect((await fetch(`${base}/w1`, { method: 'POST', body: '{"accent":"#30a46c"}' })).status).toBe(200)
      expect((await fetch(`${base}/w1/image`, { method: 'PUT', body: 'not an image' })).status).toBe(415)
      expect((await fetch(`${base}/w1/image`, { method: 'PUT', body: Buffer.alloc(600 * 1024) })).status).toBe(413)
      expect((await fetch(`${base}/w1/image`, { method: 'PUT', body: SVG })).status).toBe(200)
      const list = await (await fetch(base)).json() as { items: { w1: { accent: string; iconUrl: string } } }
      expect(list.items.w1.accent).toBe('#30a46c')
      const icon = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${list.items.w1.iconUrl}`)
      expect(icon.status).toBe(200)
      expect(icon.headers.get('content-type')).toBe('image/svg+xml')
      expect(icon.headers.get('content-security-policy')).toContain('sandbox')
      expect((await fetch(`${base}/icon/nope`)).status).toBe(404)
      expect((await fetch(base, { method: 'DELETE' })).status).toBe(405)
      // Reads pass the fence as reads; every write passes it as a mutation.
      expect(refused).toContain(true)
      expect(refused).toContain(false)
    } finally {
      server.close()
    }
  })
})
