import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const website = resolve(import.meta.dirname, '..', '..', 'website')
const config = JSON.parse(readFileSync(resolve(website, 'vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const csp = config.headers.flatMap(rule => rule.headers).find(header => header.key === 'Content-Security-Policy')?.value ?? ''
const page = readFileSync(resolve(website, 'index.html'), 'utf8')

describe('website security headers', () => {
  it('allows scripts only from the site itself', () => {
    expect(csp).toContain("script-src 'self' 'unsafe-inline';")
    expect(csp).not.toContain('esm.sh')
    expect(csp).not.toContain('buymeacoffee')
  })

  it('the page loads no script from another host, so the tighter rule breaks nothing', () => {
    expect(page).not.toMatch(/<script[^>]+src=["']https?:/iu)
    expect(page).not.toMatch(/from\s+["']https?:/iu)
    expect(page).not.toMatch(/import\(["']https?:/iu)
  })

  it('the archived page that used esm.sh stays out of the deployment', () => {
    expect(readFileSync(resolve(website, '.vercelignore'), 'utf8')).toMatch(/^archive/mu)
  })
})
