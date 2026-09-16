/** The /idealize/models page: default model, auto preferences, spend link. */

/**
 * Render the models page.
 * @returns the complete HTML document.
 */
export function modelsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IDEalize — models</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 24px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #FFFFFF; color: #24292F; }
  @media (prefers-color-scheme: dark) {
    body { background: #2F353C; color: #D5DDE3; }
    select, .card { background: #383E45 !important; border-color: rgba(213,221,227,0.12) !important; color: inherit; }
    button { background: #85C1B4; color: #2F353C; }
    .muted { color: #A3ABB1; }
    a { color: #85C1B4; }
  }
  main { max-width: 560px; margin: 0 auto; display: grid; gap: 10px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 15px; margin: 14px 0 0; }
  .muted { color: #66696D; font-size: 13px; }
  select { font: inherit; font-size: 14px; padding: 8px 10px; border: 1px solid rgba(36,41,47,0.2);
    border-radius: 10px; background: #fff; width: 100%; box-sizing: border-box; }
  button { font: inherit; font-size: 14px; font-weight: 600; border: 0; border-radius: 10px; padding: 10px 14px;
    background: #0969DA; color: #fff; cursor: pointer; justify-self: start; }
  .card { border: 1px solid rgba(36,41,47,0.13); border-radius: 10px; padding: 12px; background: #F7F7F8; display: grid; gap: 8px; }
  .pref { display: grid; grid-template-columns: 110px 1fr 34px; gap: 10px; align-items: center; }
  input[type=range] { width: 100%; accent-color: #0969DA; }
  a { color: #0969DA; }
  #defaultStatus, #prefStatus { min-height: 20px; }
</style>
</head>
<body>
<main>
  <h1>Models</h1>

  <h2>Default model</h2>
  <p class="muted">New chats and scheduled runs start on this model. Any chat can still be pinned to a different one.</p>
  <div class="card">
    <label class="pref" style="grid-template-columns: auto 1fr;"><input type="radio" name="mode" value="auto" id="modeAuto"><span><strong>Auto</strong> — IDEalize keeps the default on the best usable route: free tokens while the engine has keys, your subscription otherwise.</span></label>
    <label class="pref" style="grid-template-columns: auto 1fr;"><input type="radio" name="mode" value="manual" id="modeManual"><span><strong>Manual</strong> — you pick below; choosing a model also switches auto off.</span></label>
    <div id="autoStatus" class="muted"></div>
  </div>
  <select id="model"></select>
  <button id="setDefault">Set as default</button>
  <div id="defaultStatus" class="muted"></div>

  <h2>Auto-selection preferences</h2>
  <p class="muted">How auto weighs its choice. Cost or speed in front puts free tokens first; intelligence in front puts your subscription first.</p>
  <div class="card">
    <div class="pref"><span>Cost</span><input type="range" id="cost" min="0" max="100"><span id="costV"></span></div>
    <div class="pref"><span>Speed</span><input type="range" id="speed" min="0" max="100"><span id="speedV"></span></div>
    <div class="pref"><span>Intelligence</span><input type="range" id="intelligence" min="0" max="100"><span id="intelligenceV"></span></div>
  </div>
  <button id="savePrefs">Save preferences</button>
  <div id="prefStatus" class="muted"></div>

  <h2>Spend</h2>
  <p class="muted">Per-project token cost and value: <a href="/idealize/spend">open the spend meter</a>.</p>
</main>
<script>
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }
const NAMES = ['cost', 'speed', 'intelligence']
async function refresh() {
  const state = await (await fetch('/idealize/models/state')).json()
  const picker = document.getElementById('model')
  picker.textContent = ''
  const usable = state.providers.filter(p => p.models.length)
  const dormant = state.providers.length - usable.length
  for (const provider of usable) {
    const group = document.createElement('optgroup')
    group.label = provider.displayName
    for (const id of provider.models) {
      const option = document.createElement('option')
      option.value = provider.provider + '\\u0000' + id
      option.textContent = id
      if (state.default && state.default.provider === provider.provider && state.default.model === id) option.selected = true
      group.append(option)
    }
    picker.append(group)
  }
  if (dormant > 0) {
    const note = document.createElement('optgroup')
    note.label = dormant + ' more providers available once signed in or keyed'
    picker.append(note)
  }
  for (const name of NAMES) {
    const slider = document.getElementById(name)
    slider.value = state.preferences[name]
    document.getElementById(name + 'V').textContent = slider.value
    slider.oninput = () => { document.getElementById(name + 'V').textContent = slider.value }
  }
  document.getElementById(state.mode === 'auto' ? 'modeAuto' : 'modeManual').checked = true
  showAuto(state.mode, state.auto)
}
function showAuto(mode, auto) {
  const line = document.getElementById('autoStatus')
  if (mode !== 'auto') { line.textContent = ''; return }
  if (!auto) { line.textContent = 'Auto is on; first pass runs shortly.'; return }
  line.textContent = (auto.model ? 'Auto picked ' + auto.provider + ' / ' + auto.model + ' — ' : 'Auto found nothing usable — ') + auto.reason + '.'
}
for (const id of ['modeAuto', 'modeManual']) {
  document.getElementById(id).onchange = async (event) => {
    const mode = event.target.value
    const res = await fetch('/idealize/models/mode', { method: 'POST', headers: HEADERS, body: JSON.stringify({ mode }) })
    if (!res.ok) { document.getElementById('autoStatus').textContent = 'Failed to switch mode.'; return }
    const body = await res.json()
    showAuto(body.mode, body.auto)
    if (mode === 'auto') refresh()
  }
}
document.getElementById('setDefault').onclick = async () => {
  const status = document.getElementById('defaultStatus')
  const value = document.getElementById('model').value
  if (!value) { status.textContent = 'Pick a model first.'; return }
  const [provider, model] = value.split('\\u0000')
  const res = await fetch('/idealize/models/default', { method: 'POST', headers: HEADERS, body: JSON.stringify({ provider, model }) })
  status.textContent = res.ok ? 'Default set — new chats use ' + model + '.' : 'Failed to set default.'
  if (res.ok) refresh()
}
document.getElementById('savePrefs').onclick = async () => {
  const status = document.getElementById('prefStatus')
  const body = {}
  for (const name of NAMES) body[name] = Number(document.getElementById(name).value)
  const res = await fetch('/idealize/models/preferences', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  status.textContent = res.ok ? 'Preferences saved.' : 'Failed to save.'
}
refresh()
</script>
</body>
</html>`
}
