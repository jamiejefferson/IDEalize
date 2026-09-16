# Agent Note: JJ's morning six — a menu nobody could see, and a group chat written in uuids

Status: implemented

JJ used the landing-25 build for a morning and came back with six faults. Two were invisible surfaces, two were missing or wrong controls, and two were the Studio timeline printing machine identifiers where a person expects names.

## Problem

**The three-dot menu opened into nothing.** Pressing it set `aria-expanded="true"`, mounted the panel, and gave it a 282x141 box which `checkVisibility()` called visible. Nothing appeared. Two separate faults stacked. The panel asked for `--dsw-alias-bg-elevated` and `--dsw-alias-border-secondary`, neither of which the theme defines, so it painted a transparent ground behind a zero-width border. Underneath that, the tool row it opens out of carries `overflow-x: auto` (added 7 Sep so the row scrolls sideways when crowded), and CSS forces the other axis to `auto` with it — so the row's 32px box clipped a panel that opens 143px above it, and `elementFromPoint` over the panel returned the transcript behind it.

**The Studio timeline was written in session ids.** Every row read `session-11d20279-7215-4652-a33c-98221e97304a  Message` over its body. The timeline records `author` as a session id, which is correct — ids are stable and names are not — but nothing resolved them at render, so the one surface built for reading a project's coordination was unreadable. The artefact lines compounded it: `describeArtefacts` appended each record's uuid, so "generated 3 images (ea340464-9de1-4426-…, …)" buried the count behind the keys.

**The running indicator did not belong to the app.** `StateDot`'s `ongoing` state was a pixel-art chase: eight cells of a 3x3 matrix stepping clockwise with a decaying trail, inherited from the upstream figma. It reads as retro loading chrome and nothing else in IDEalize looks like it.

**Nothing on the composer said files could be attached.** The image intake exists and works, but only paste and whole-page drop reach it. The "+" opens the command menu, and JJ read it as attach.

**The plan-mode icon was a document.** A bordered page of ruled lines, sitting one seat away from a document-shaped session-log button.

## Decision

**A surface states its own colours from defined tokens.** The panel takes `--dsw-alias-bg-layer-2` over `--dsw-alias-border-l3`, each with a literal fallback, and the same correction goes to the message-feedback note box, the only other place in the repository asking for those two undefined names.

**A panel that must escape a scrolling row leaves the row.** The overflow panel portals to the body and positions itself `fixed` against the trigger's box, re-measured on layout and on resize. Nothing in the composer's clipping chain can reach it, and the outside-pointer close now tests the portalled panel as well as the trigger.

**The Studio reads ids through the roster it already autocompletes from.** `StudioViewInjected` gains `useNames`, a selector over the session list's `agentName` projection — the same source the view's `@` trigger source completes from, so a reference and its completion can never disagree. Every participant reference in the view (timeline author and target, synthesis author, task owner, attention owner, agent row) renders through one `AgentRef`.

**A reference is the start of a reply.** `AgentRef` is a button: clicking it puts `@Name ` at the front of the composer's draft, which is where the host's routing reads an address (JJ: "so other agents can easily link to the chat for context or ask a follow-up"). An id the roster cannot name renders as itself, inert, because there is no name to address.

**The chat line says what happened, not which keys were written.** `describeArtefacts` counts per media kind and drops the uuids; the ids stay on the artefact records an agent lists.

**The running indicator is a turning gear.** Eight teeth around a hub, one revolution every 2.4s, animated as a single composited transform so it stays legible at 10px, and stopped under `prefers-reduced-motion`.

**Attach is a paperclip at the trailing end of the ask bar**, where V0 had it. Picked images go down the existing intake; any other file's disk path is resolved through the desktop preload's `__DSH_DESKTOP_FILE_PATH__` bridge and appended to the draft, which is how the Files pane's "add to chat" already hands a document to an agent. A browser deployment has no bridge, so a document picked there is announced as droppable-or-pasteable rather than silently dropped.

**The plan icon is three ticked steps**, naming what plan mode produces.

## Alternatives considered

**Giving the tool row `overflow-x: clip`.** `clip` on one axis does leave the other `visible`, which would have fixed the clipping without a portal — but it also stops the row scrolling, which is the reason the overflow was added.

**Resolving Studio names on the wire.** The service already has a private `participants()`, and the overview could carry a roster. The session list already holds the same projection in the browser, so the wire change would have added a second source of names for the same people.

**Reading document text in the renderer instead of resolving a path.** It needs no desktop bridge, but it puts the file's contents in the message rather than a handle the agent can re-open, and it has no answer for a binary.

## Consequences

`@idealize/activity-pills` now imports `react-dom` for the portal and declares `@types/react-dom`; the panel is no longer inside the component's own subtree, so a test asserting containment has to look at `document`.

Three upstream packages are touched and logged in FORK.md: the composer gains the attach control, `StateDot`'s ongoing state changes shape for every consumer (the session rows and the terminal block), and the feedback note box takes the corrected tokens.

`describeArtefacts` no longer emits artefact ids. Nothing parses that line — it is prose in a group chat — but an agent that wanted the ids from the chat rather than from the artefact store would no longer find them there.
