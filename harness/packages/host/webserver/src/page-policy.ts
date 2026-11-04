/**
 * The Content-Security-Policy on the app's own pages. A chat renders text from
 * anywhere (web pages, repositories, other agents), so this is the second line
 * behind the renderer's own escaping: markup that slips through cannot run an
 * inline script, load a script from elsewhere, send data to another server, or
 * frame the app.
 *
 * Each allowance below is here because a page needs it. Removing one means
 * re-proving the surface named beside it with a real page load.
 */

import { createHash } from 'node:crypto'

/** Every directive except `script-src`, which depends on the page. */
const SHARED_DIRECTIVES = [
  "default-src 'self'",
  // Inline styles: emotion-free CSS modules still carry `style=` attributes,
  // the terminal grid (xterm) writes <style> elements, and the index taps inject
  // the theme, font and splash styles.
  "style-src 'self' 'unsafe-inline'",
  // https: model thumbnails from a provider's catalogue. https: and http: an
  // image in agent output once the person has clicked to load it; nothing fetches
  // one before that (ui-primitives RemoteImage). data: and blob: are local:
  // attachments, the feedback screenshot, KaTeX, and project logos.
  "img-src 'self' data: blob: https: http:",
  // https: sample clips in the model browser. data: and blob: are local: the
  // voice clips and the onboarding owl.
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // 'self' covers the app's own socket as well as its routes. Nothing in a page
  // may call any other server; models are reached from the host.
  "connect-src 'self' data: blob:",
  // Files shown in the panel and the service hatch, all from the app's origin.
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
]

/**
 * What scripts every page may run, beyond the page's own inline hashes.
 * blob: Powell's microphone tap is an audio worklet built from a blob.
 * 'unsafe-eval': a dynamic plugin's browser half runs through `new Function`
 * (cordis-client-runner, after the person approves the run).
 */
const SCRIPT_SOURCES = "'self' blob: 'unsafe-eval'"

/**
 * The policy for the app's main page.
 * @param html - the final index.html body, after every index tap.
 * @returns the header value: inline scripts run only when their exact text is hashed here.
 */
export function appPagePolicy(html: string): string {
  const hashes = inlineScripts(html).map(text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`)
  return [`script-src ${[SCRIPT_SOURCES, ...hashes].join(' ')}`, ...SHARED_DIRECTIVES].join('; ')
}

/**
 * The policy for a page a route renders itself (service hatch, sign-in, spend,
 * status, model list). Those pages are fixed text with inline scripts and hold
 * no agent output, so inline script stays allowed; everything else stays shut,
 * so nothing they run can reach another server. A route that serves someone's
 * file sends its own sandboxed policy, which replaces this one.
 */
export const ROUTE_PAGE_POLICY = [`script-src ${SCRIPT_SOURCES} 'unsafe-inline'`, ...SHARED_DIRECTIVES].join('; ')

/**
 * The text of each inline script, the way the browser hashes it.
 * @param html - a rendered page.
 * @returns one string per `<script>` element with no `src`.
 */
function inlineScripts(html: string): string[] {
  const scripts: string[] = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1] ?? '')) scripts.push(match[2] ?? '')
  }
  return scripts
}
