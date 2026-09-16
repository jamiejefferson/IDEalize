/**
 * The global stylesheet behind the panel beats, injected by the client plugin
 * at apply (the appearance package's sheet precedent) and gated on the
 * `data-idealize-launch="playing"` body attribute the launch machine sets for
 * exactly one sequence per app launch. The sidebar column slides in from the
 * left; the conversation root slides in from the right after it. The rail
 * carries its own gated keyframe in ui-bar (same delays as the chat beat).
 */

/** Id of the injected style tag (one per document; teardown removes it). */
export const LAUNCH_SHEET_ID = 'idealize-launch'

/**
 * The panel-beat sheet. Delays sequence after the logo fade (350ms): sidebar
 * at 300ms, chat at 470ms; the last beat ends at 790ms, inside the machine's
 * 850ms budget. `backwards` fill holds each panel at its from-state through
 * its delay, so nothing flashes settled between the logo fade and its beat.
 */
export const LAUNCH_SHEET_CSS = `
@keyframes idealize-launch-slide-in-left {
  from { opacity: 0; transform: translateX(-28px); }
  to { opacity: 1; transform: none; }
}
@keyframes idealize-launch-slide-in-right {
  from { opacity: 0; transform: translateX(28px); }
  to { opacity: 1; transform: none; }
}
body[data-idealize-launch="playing"] [data-idealize-surface="sessions"] {
  animation: idealize-launch-slide-in-left 300ms var(--ds-ease-in-out, ease-in-out) 300ms backwards;
}
body[data-idealize-launch="playing"] [data-idealize-surface="chat"] {
  animation: idealize-launch-slide-in-right 320ms var(--ds-ease-in-out, ease-in-out) 470ms backwards;
}
@media (prefers-reduced-motion: reduce) {
  body[data-idealize-launch="playing"] [data-idealize-surface="sessions"],
  body[data-idealize-launch="playing"] [data-idealize-surface="chat"] {
    animation: none;
  }
}
`
