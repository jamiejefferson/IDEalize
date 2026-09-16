/**
 * The /idealize/spend page: per-project token spend from the embedded
 * engine's request ledger. "Value" prices every token at the paid rate, so
 * work done on free routes still shows what it was worth.
 */

/**
 * Render the spend page.
 * @returns the complete HTML document.
 */
export function spendPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IDEalize — spend</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 32px 24px; font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #FFFFFF; color: #24292F; }
  @media (prefers-color-scheme: dark) {
    body { background: #2F353C; color: #D5DDE3; }
    .card, select { background: #383E45 !important; border-color: rgba(213,221,227,0.12) !important; color: inherit; }
    .muted { color: #A3ABB1; }
    .bar { background: #85C1B4; }
  }
  main { max-width: 640px; margin: 0 auto; display: grid; gap: 10px; }
  h1 { font-size: 22px; margin: 0; }
  .muted { color: #66696D; font-size: 13px; }
  select { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid rgba(36,41,47,0.2);
    border-radius: 8px; background: #fff; justify-self: start; }
  .card { border: 1px solid rgba(36,41,47,0.13); border-radius: 10px; padding: 10px 12px; background: #F7F7F8; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .value { font-weight: 600; }
  .track { height: 6px; border-radius: 3px; background: rgba(36,41,47,0.08); margin-top: 8px; overflow: hidden; }
  .bar { height: 100%; border-radius: 3px; background: #0969DA; }
</style>
</head>
<body>
<main>
  <h1>Spend</h1>
  <p class="muted">What each project's model work is worth, from the free-tokens engine's request ledger. Value prices every token at the paid rate — work served by free routes cost nothing out of pocket, but the value line shows what it saved.</p>
  <select id="range">
    <option value="24h">Last 24 hours</option>
    <option value="7d">Last 7 days</option>
    <option value="30d" selected>Last 30 days</option>
  </select>
  <div id="projects" class="muted">Loading…</div>
</main>
<script>
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node }
function money(v) { return '$' + (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4)) }
function tokens(v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v) }
async function refresh() {
  const range = document.getElementById('range').value
  const root = document.getElementById('projects')
  try {
    const rows = await (await fetch('/idealize/spend/by-project?range=' + range)).json()
    if (!Array.isArray(rows)) throw new Error(rows.error || 'bad response')
    root.textContent = rows.length ? '' : 'No model calls in this range yet.'
    const top = Math.max(...rows.map(r => r.estimatedValue), 0.0001)
    for (const row of rows) {
      const card = el('div', 'card')
      const head = el('div', 'row')
      head.append(el('span', '', row.label))
      head.append(el('span', 'value', money(row.estimatedValue)))
      card.append(head)
      card.append(el('div', 'muted', row.requests + ' calls · ' + tokens(row.totalInputTokens) + ' in / ' + tokens(row.totalOutputTokens) + ' out'))
      const track = el('div', 'track'); const bar = el('div', 'bar')
      bar.style.width = Math.max(2, Math.round(row.estimatedValue / top * 100)) + '%'
      track.append(bar); card.append(track)
      root.append(card)
    }
  } catch (error) { root.textContent = 'Spend unavailable: ' + error.message }
}
document.getElementById('range').onchange = refresh
refresh()
</script>
</body>
</html>`
}
