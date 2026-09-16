/**
 * The /idealize/signin page: a self-contained branded page listing OAuth
 * providers with sign-in/sign-out actions against the pack's endpoints.
 * Deliberately dependency-free (inline CSS in the IDEalize palette, plain
 * fetch) so it works before any client bundle loads.
 */

/**
 * Render the sign-in page.
 * @returns the complete HTML document.
 */
export function signinPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IDEalize — sign in</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 48px 24px; font: 15px/1.5 -apple-system, BlinkMacSystemFont,
      'Segoe UI', sans-serif; background: #FFFFFF; color: #24292F;
    display: flex; justify-content: center;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #2F353C; color: #D5DDE3; }
    .card { background: #383E45; border-color: rgba(213,221,227,0.12); }
    .sub { color: #A3ABB1; }
    button { background: #85C1B4; color: #2F353C; }
    button.ghost { background: none; color: #A3ABB1; border: 1px solid rgba(213,221,227,0.16); }
  }
  main { max-width: 460px; width: 100%; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: #66696D; margin: 0 0 28px; }
  .card {
    border: 1px solid rgba(36,41,47,0.13); border-radius: 12px; padding: 16px;
    background: #F3F3F4; margin-bottom: 12px; display: flex; align-items: center;
    justify-content: space-between; gap: 12px;
  }
  .name { font-weight: 600; }
  .state { font-size: 12px; opacity: 0.7; }
  .code { font-size: 13px; margin-top: 4px; font-variant-numeric: tabular-nums; }
  button {
    font: inherit; font-size: 13px; font-weight: 600; border: 0; border-radius: 10px;
    padding: 8px 14px; background: #0969DA; color: #fff; cursor: pointer;
  }
  button.ghost { background: none; color: #66696D; border: 1px solid rgba(36,41,47,0.16); }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<main>
  <h1>Sign in</h1>
  <p class="sub">Connect a subscription. Keys can also be pasted on the Models settings page.</p>
  <div id="providers">Loading…</div>
</main>
<script>
const HEADERS = { 'x-idealize-auth': '1' }
async function refresh() {
  const providers = await (await fetch('/idealize/auth/providers')).json()
  const root = document.getElementById('providers')
  root.textContent = ''
  for (const provider of providers) {
    const card = document.createElement('div')
    card.className = 'card'
    const left = document.createElement('div')
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = provider.name
    const state = document.createElement('div')
    state.className = 'state'
    state.textContent = provider.error ? ('Error: ' + provider.error)
      : provider.stored ? 'Connected'
      : provider.pending ? 'Waiting for browser sign-in…'
      : (provider.loginLabel || 'Not connected')
    left.append(name, state)
    // A device-code flow's page usually carries the code in its URL; the code
    // is shown as well for the page that asks for it.
    if (provider.pending && provider.userCode) {
      const code = document.createElement('div')
      code.className = 'code'
      code.textContent = 'If the page asks for a code, enter ' + provider.userCode
      left.append(code)
    }
    const button = document.createElement('button')
    if (provider.stored) {
      button.textContent = 'Sign out'
      button.className = 'ghost'
      button.onclick = async () => {
        button.disabled = true
        await fetch('/idealize/auth/logout?provider=' + provider.id, { method: 'POST', headers: HEADERS })
        refresh()
      }
    } else {
      button.textContent = provider.pending ? 'Continue in browser' : 'Sign in'
      button.onclick = async () => {
        button.disabled = true
        const result = await (await fetch('/idealize/auth/login?provider=' + provider.id, { method: 'POST', headers: HEADERS })).json()
        if (result.authUrl) window.open(result.authUrl, '_blank')
        poll(provider.id)
      }
    }
    card.append(left, button)
    root.append(card)
  }
}
async function poll(id) {
  for (let i = 0; i < 450; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const status = await (await fetch('/idealize/auth/status?provider=' + id)).json()
    if (status.stored || status.error) break
  }
  refresh()
}
refresh()
</script>
</body>
</html>`
}
