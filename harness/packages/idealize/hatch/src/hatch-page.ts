/**
 * The /idealize/hatch page. Two halves in plain language: the V0 service
 * hatch (amend the running app from a chat rooted in its own source) and the
 * harness composability view (what the app is made of, home-patch editing
 * with snapshots and rollback).
 */

/**
 * Render the service hatch page.
 * @returns the complete HTML document.
 */
export function hatchPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IDEalize — service hatch</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 24px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #FFFFFF; color: #24292F; }
  @media (prefers-color-scheme: dark) {
    body { background: #2F353C; color: #D5DDE3; }
    .card, textarea { background: #383E45 !important; border-color: rgba(213,221,227,0.12) !important; color: inherit; }
    button { background: #85C1B4; color: #2F353C; }
    .muted { color: #A3ABB1; }
    code { background: rgba(213,221,227,0.1); }
  }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  .muted { color: #66696D; font-size: 13px; }
  .card { border: 1px solid rgba(36,41,47,0.13); border-radius: 10px; padding: 10px 12px; background: #F7F7F8; margin-bottom: 8px; }
  code { background: rgba(36,41,47,0.06); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
  textarea { width: 100%; box-sizing: border-box; font: 12px/1.5 ui-monospace, 'DM Mono', monospace; padding: 10px;
    border: 1px solid rgba(36,41,47,0.2); border-radius: 10px; background: #fff; min-height: 180px; }
  button { font: inherit; font-size: 13px; font-weight: 600; border: 0; border-radius: 8px; padding: 7px 11px;
    background: #0969DA; color: #fff; cursor: pointer; margin-right: 6px; }
  #status, #serviceStatus { min-height: 20px; }
</style>
</head>
<body>
<main>
  <h1>Service hatch</h1>
  <p class="muted">IDEalize can work on itself. This page is the way in: open the app's own
    source as a project and chat your changes into it, or adjust what the app is made of below.</p>

  <h2>Amend the service</h2>
  <div id="service" class="card muted">Checking for the source checkout…</div>
  <div><button id="amend">Open the service as a project</button><span id="serviceStatus" class="muted"></span></div>
  <p class="muted">This adds the checkout to your Projects sidebar. Start a chat there and the
    agent is briefed by the repo's own instructions; restart the app to see your changes live.</p>

  <h2>What the app is made of</h2>
  <p class="muted">Every feature is a plugin, stacked in layers. This is the stack each profile
    mounts, bottom to top — the home patch below is yours and always wins.</p>
  <div id="profiles" class="muted">Loading…</div>

  <h2>Change the composition</h2>
  <p class="muted">Your home patch, applied over everything else on restart. Every save is
    checked first and snapshotted, so you can always roll back.</p>
  <textarea id="patch" spellcheck="false"></textarea>
  <div style="margin-top:8px"><button id="save">Snapshot &amp; save</button><span id="status" class="muted"></span></div>
  <h2>Snapshots</h2>
  <div id="snapshots" class="muted">Loading…</div>
</main>
<script>
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node }

async function refreshService() {
  const box = document.getElementById('service')
  const amend = document.getElementById('amend')
  try {
    const service = await (await fetch('/idealize/hatch/service')).json()
    box.textContent = ''
    if (!service.valid) {
      box.append(el('span', '', 'No source checkout found at '))
      box.append(el('code', '', service.path))
      box.append(el('span', '', '. Clone the repo there, or edit the source path on the Service tab.'))
      amend.disabled = true
      return
    }
    box.append(el('span', '', service.workspaceId ? 'The service is open as a project: ' : 'Source checkout found: '))
    box.append(el('code', '', service.path))
    amend.disabled = false
    amend.textContent = service.workspaceId ? 'Already in your sidebar' : 'Open the service as a project'
    if (service.workspaceId) amend.disabled = true
  } catch {
    box.textContent = 'Could not check the service source.'
  }
}

document.getElementById('amend').onclick = async () => {
  const status = document.getElementById('serviceStatus')
  status.textContent = 'Opening…'
  const res = await fetch('/idealize/hatch/amend', { method: 'POST', headers: HEADERS })
  const body = await res.json()
  status.textContent = res.ok
    ? (body.created ? 'Added to your Projects sidebar — start a chat there.' : 'Already in your sidebar.')
    : (body.error || 'Could not open the project.')
  refreshService()
}

async function refresh() {
  const comp = await (await fetch('/idealize/hatch/composition')).json()
  const root = document.getElementById('profiles'); root.textContent = ''
  for (const profile of comp.profiles) {
    const card = el('div', 'card')
    card.append(el('div', '', 'Profile: ' + profile.name))
    if (profile.error) { card.append(el('div', 'muted', 'unreadable: ' + profile.error)); root.append(card); continue }
    for (const layer of profile.layers) card.append(el('div', 'muted', '└ ' + layer.packageName + ' (' + layer.patchCount + ' rows)'))
    card.append(el('div', 'muted', '└ profile patch (' + profile.profilePatchCount + ' rows) └ home patch (' + comp.homePatchCount + ' rows)'))
    const entries = el('div', 'muted'); entries.style.marginTop = '6px'
    entries.textContent = 'Mounts: '
    for (const id of profile.entries) { const c = el('code', '', id); c.style.marginRight = '4px'; entries.append(c) }
    card.append(entries)
    root.append(card)
  }
  document.getElementById('patch').value = await (await fetch('/idealize/hatch/home-patch')).text()
  const snaps = await (await fetch('/idealize/hatch/snapshots')).json()
  const snapRoot = document.getElementById('snapshots'); snapRoot.textContent = snaps.length ? '' : 'No snapshots yet.'
  for (const name of snaps) {
    const card = el('div', 'card')
    card.style.display = 'flex'; card.style.justifyContent = 'space-between'; card.style.alignItems = 'center'
    card.append(el('span', '', name.replace('.yml', '')))
    const restore = el('button', '', 'Roll back')
    restore.onclick = async () => {
      const res = await fetch('/idealize/hatch/rollback?name=' + encodeURIComponent(name), { method: 'POST', headers: HEADERS })
      document.getElementById('status').textContent = res.ok ? 'Rolled back. Restart applies it.' : 'Rollback failed.'
      refresh()
    }
    card.append(restore)
    snapRoot.append(card)
  }
}
document.getElementById('save').onclick = async () => {
  const status = document.getElementById('status')
  status.textContent = 'Saving…'
  const res = await fetch('/idealize/hatch/home-patch', { method: 'POST', headers: HEADERS,
    body: JSON.stringify({ content: document.getElementById('patch').value }) })
  const body = await res.json()
  status.textContent = res.ok ? 'Saved. Restart applies it.' : (body.error || 'Save failed.')
  refresh()
}
refreshService()
refresh()
</script>
</body>
</html>`
}
