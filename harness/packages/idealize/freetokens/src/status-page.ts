/** The /idealize/freetokens page: engine status, provider keys, adoption. */

interface StatusView {
  baseURL: string
  detected: boolean
  keyStored: boolean
  routeRegistered: boolean
  modelCount?: number
  embedded?: string
}

/** Platforms surfaced in the add-key picker, most useful first. */
const FEATURED_PLATFORMS = [
  'openrouter', 'google', 'groq', 'cerebras', 'mistral', 'cohere',
  'cloudflare', 'github', 'nvidia', 'huggingface', 'ollama', 'custom',
]

/**
 * Render the /idealize/freetokens status page.
 * @param view - the engine, route, and key facts the page states.
 * @returns the complete HTML document.
 */
export function statusPage(view: StatusView): string {
  const embeddedMode = view.embedded !== undefined
  const engineLine = embeddedMode
    ? `Built-in engine ${view.embedded}`
    : view.detected
      ? `FreeLLMAPI answering at ${view.baseURL}`
      : `Nothing answering at ${view.baseURL} — start your FreeLLMAPI server, then reload`
  const routeLine = view.routeRegistered
    ? `Provider registered${view.modelCount === undefined ? '' : ` with ${view.modelCount} models`} — pick a "Free tokens" model in the model selector`
    : 'Provider not registered yet'
  const options = FEATURED_PLATFORMS.map(name => `<option value="${name}">${name}</option>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IDEalize — free tokens</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 24px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #FFFFFF; color: #24292F; }
  @media (prefers-color-scheme: dark) {
    body { background: #2F353C; color: #D5DDE3; }
    input, select, .card { background: #383E45 !important; border-color: rgba(213,221,227,0.12) !important; color: inherit; }
    button { background: #85C1B4; color: #2F353C; }
    .muted { color: #A3ABB1; }
  }
  main { max-width: 560px; margin: 0 auto; display: grid; gap: 10px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 15px; margin: 14px 0 0; }
  .muted { color: #66696D; font-size: 13px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .dot { width: 10px; height: 10px; border-radius: 5px; flex: none; }
  .on { background: #1A7F37; } .off { background: #CF222E; }
  .card { border: 1px solid rgba(36,41,47,0.13); border-radius: 10px; padding: 8px 12px; background: #F7F7F8;
    display: flex; justify-content: space-between; gap: 10px; }
  input, select { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid rgba(36,41,47,0.2);
    border-radius: 10px; background: #fff; box-sizing: border-box; }
  input { width: 100%; }
  button { font: inherit; font-size: 14px; font-weight: 600; border: 0; border-radius: 10px; padding: 10px 14px;
    background: #0969DA; color: #fff; cursor: pointer; justify-self: start; }
  #status, #adoptStatus { min-height: 20px; }
</style>
</head>
<body>
<main>
  <h1>Free tokens</h1>
  <p class="muted">Free tokens routes model calls through IDEalize's built-in aggregator, which pools free-tier providers behind one endpoint, tracks their monthly budgets and cools down exhausted keys.</p>
  <div class="row"><span class="dot ${embeddedMode ? (view.routeRegistered ? 'on' : 'off') : (view.detected ? 'on' : 'off')}"></span><span>${engineLine}</span></div>
  <div class="row"><span class="dot ${view.routeRegistered ? 'on' : 'off'}"></span><span>${routeLine}</span></div>

  <h2>Provider keys</h2>
  <p class="muted">Add keys for the providers you have accounts with — OpenRouter unlocks the most models. Free-tier keys are enough; the engine prefers free routes and backs off before limits bite.</p>
  <div id="keys" class="muted">Loading…</div>
  <div class="row">
    <select id="platform">${options}</select>
    <input id="key" type="password" placeholder="API key">
  </div>
  <button id="add">Add key</button>
  <div id="status" class="muted"></div>

  ${embeddedMode ? '' : `<h2>Adopt an existing instance</h2>
  <input id="adoptKey" type="password" placeholder="FreeLLMAPI unified key (freellmapi-…)">
  <button id="adopt">Verify &amp; register</button>
  <div id="adoptStatus" class="muted"></div>`}
</main>
<script>
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }
async function refreshKeys() {
  const root = document.getElementById('keys')
  try {
    const keys = await (await fetch('/idealize/freetokens/provider-keys')).json()
    const list = Array.isArray(keys) ? keys : (keys.keys || [])
    root.textContent = list.length ? '' : 'No provider keys yet.'
    for (const item of list) {
      const card = document.createElement('div'); card.className = 'card'
      const left = document.createElement('span')
      left.textContent = item.platform + (item.label ? ' — ' + item.label : '')
      const right = document.createElement('span'); right.className = 'muted'
      right.textContent = item.status || (item.enabled ? 'enabled' : 'disabled')
      card.append(left, right); root.append(card)
    }
  } catch { root.textContent = 'Key list unavailable (engine still starting, or adopted instance).' }
}
document.getElementById('add').onclick = async () => {
  const status = document.getElementById('status')
  const platform = document.getElementById('platform').value
  const key = document.getElementById('key').value.trim()
  status.textContent = 'Saving…'
  try {
    const res = await fetch('/idealize/freetokens/provider-key', { method: 'POST', headers: HEADERS,
      body: JSON.stringify({ platform, key }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error?.message || body.error || 'HTTP ' + res.status)
    status.textContent = 'Saved.' + (body.models ? ' Route refreshed with ' + body.models + ' models.' : '') + (body.notice ? ' ' + body.notice : '')
    document.getElementById('key').value = ''
    refreshKeys()
  } catch (error) { status.textContent = 'Failed: ' + error.message }
}
const adopt = document.getElementById('adopt')
if (adopt) adopt.onclick = async () => {
  const status = document.getElementById('adoptStatus')
  const apiKey = document.getElementById('adoptKey').value.trim()
  if (!apiKey) { status.textContent = 'Paste the unified key first.'; return }
  status.textContent = 'Verifying…'
  try {
    const res = await fetch('/idealize/freetokens/adopt', { method: 'POST', headers: HEADERS, body: JSON.stringify({ apiKey }) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status)
    status.textContent = 'Registered ' + body.models + ' models. Reload the app to see them.'
  } catch (error) { status.textContent = 'Failed: ' + error.message }
}
refreshKeys()
</script>
</body>
</html>`
}
