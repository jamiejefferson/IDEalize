/**
 * The IDEalize boot splash: V0's owl over the brand ground with the
 * "What shall we make?" wordmark, shown from the first byte of HTML until
 * the client mounts (or a 10-second hard timeout). Pure inline markup —
 * no requests, so it paints before the client bundle even starts loading.
 * The in-app welcome slate (replacing the client's own empty state) is
 * queued client-slot work; this covers the boot moment.
 */

import { OWL_FRAMES } from './splash-frames.ts'

/** The id of the splash root element, which the client removes once it renders. */
export const SPLASH_ID = 'idealize-splash'

/**
 * Render the boot splash: inline styles, the owl frames, and the script that plays them.
 * @returns the self-contained HTML fragment.
 */
export function splashMarkup(): string {
  const frames = JSON.stringify(OWL_FRAMES)
  return `<div id="${SPLASH_ID}">
<style>
#${SPLASH_ID} {
  position: fixed; inset: 0; z-index: 99999; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 18px;
  background: #FFFFFF; transition: opacity 320ms ease; }
@media (prefers-color-scheme: dark) { #${SPLASH_ID} { background: #2F353C; } }
#${SPLASH_ID}.leaving { opacity: 0; pointer-events: none; }
#${SPLASH_ID} img { width: 152px; height: 168px; image-rendering: auto; }
#${SPLASH_ID} .wordmark { font: 600 21px/1 'DM Mono', ui-monospace, monospace; letter-spacing: -0.03em;
  color: #1B1F24; }
#${SPLASH_ID} .ask { font: 400 14px/1 'DM Mono', ui-monospace, monospace; letter-spacing: -0.03em;
  color: #56595D; }
@media (prefers-color-scheme: dark) {
  #${SPLASH_ID} .wordmark { color: #D5DDE3; }
  #${SPLASH_ID} .ask { color: #A3ABB1; }
}
</style>
<img alt="" id="${SPLASH_ID}-owl">
<div class="wordmark">IDEalize</div>
<div class="ask">What shall we make?</div>
<script>
(function () {
  var frames = ${frames}
  var owl = document.getElementById('${SPLASH_ID}-owl')
  var frame = 0
  owl.src = frames[0]
  var ticker = setInterval(function () { frame = (frame + 1) % frames.length; owl.src = frames[frame] }, 83)
  var leave = function () {
    var splash = document.getElementById('${SPLASH_ID}')
    if (!splash || splash.classList.contains('leaving')) return
    splash.classList.add('leaving')
    setTimeout(function () { clearInterval(ticker); splash.remove() }, 400)
  }
  // Leave when the client mounts something real, or after the hard timeout.
  var watch = function () {
    var root = document.getElementById('root') || document.getElementById('app') || document.body
    var observer = new MutationObserver(function () {
      if (root.childElementCount > 1 || (root !== document.body && root.childElementCount > 0)) {
        observer.disconnect(); setTimeout(leave, 250)
      }
    })
    observer.observe(root, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch)
  else watch()
  setTimeout(leave, 10000)
})()
</script>
</div>`
}
