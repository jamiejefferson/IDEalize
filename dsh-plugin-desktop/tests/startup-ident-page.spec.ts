import { describe, expect, it } from 'vitest'
import { STARTUP_IDENT_OWL } from '../src/startup-ident-owl.ts'
import { startupIdentHtml } from '../src/startup-ident-page.ts'

describe('startup ident page', () => {
  it('prints the version and loads nothing from the network', () => {
    const html = startupIdentHtml('1.0.13', STARTUP_IDENT_OWL)

    expect(html).toContain('"version":"1.0.13"')
    expect(html).not.toMatch(/(?:src|href)=["']https?:/)
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|@import/)
  })

  it('strips anything from the version that could break out of the script', () => {
    const html = startupIdentHtml('1.0.13</script><script>alert(1)', STARTUP_IDENT_OWL)

    expect(html).toContain('"version":"1.0.13scriptscriptalert1"')
    expect(html.match(/<\/script>/g)).toHaveLength(1)
  })
})
