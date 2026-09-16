# Agent Note: Wave C1 — the corrections JJ meets in the first ten seconds

Status: implemented

The first slice of JJ's 28 Aug review of the landed spaces-and-brains reshape (plan: `.idealize/plans/feedback-wave-c-plan.md`). Every item here is copy, order or CSS; the generation, Files, Appearance, Calendar, provider and Askbar items are later slices. The rail is `@idealize/ui-bar`'s; the session cards, the header action and the sidebar header are upstream packages the fork already touches ([FORK.md](../../../../FORK.md)).

## Problem

JJ walked the packaged app and returned thirty items. Ten of them are things the eye meets before any chat is opened, and each had a plain cause:

- The tool rail's order was the Paper "Dock launcher" frame's, with the entries the frame did not draw slotted in after their neighbours; the glyphs for Brains, Plugins, Appearance and the Service hatch were a gauge, a globe, the live theme icon and a set of sliders, none of which name the pane.
- The mini-mode toggle sat on the rail among panes, though it is a window-level control.
- Session cards put the agent's name in 13px over the chat summary in 12px tertiary, so the name read as the card and the summary as its footnote; the hover card repeated "Name · summary" and said nothing about the chat's space; project groups ran into each other with 4px between them.
- The chat header's "Session log" export was a 111×32 bordered text capsule, the largest control in the header.
- The terminal's grid ended short of its paint margin on the right only: the fit addon sizes the column count from the host's width minus xterm's fixed 14px scrollbar (`ViewportConstants.DEFAULT_SCROLL_BAR_WIDTH`), and xterm 6 paints that scrollbar as an overlay down the right of its own element.
- The Service hatch opened with a pane header ("Warning, Service Hatch Open…" and its quote) above the transcript, and its composer offered "Open as a chat", which moved the hatch session onto the main surface.
- The Brains pane titled each generating space's model row by the space (Gallery, Sound Stage, Motion), so the row read as a second heading for the group it sat in; and two sections were titled "Agent roles" and "Roles".

## Decision

**The rail reads Files, Schedule, Trajectory, Brains, Plugins, Appearance, Feedback, Service hatch**, and its glyphs are a brain, a puzzle piece, an artist's palette and a door. JJ's written order carried a Settings entry; asked, JJ said "settings is a mistake. feedback should be kept", so no Settings pane exists and Feedback holds that position. The Appearance button no longer mirrors the theme preference (`IdealizeBarInjected.hooks.themePref` and the bar's `settingsScope` injection are gone with it).

**The mini-mode toggle moves to the sidebar header.** The compatibility shell keeps the native OS frame, so the only in-app chrome that sits with the window controls is the header's control stack (collapse toggle, New chat). `@deepseek-ai/dsh-client-ui-sidebar` gains a `sidebar.header.action` root list slot rendered on the collapse toggle's row, left of it, while the sidebar is wide (the 70px header row holds two rows of controls, so a third stacked control clipped), and `@idealize/ui-bar`'s `MinimodeButton` fills it. It renders nothing while `GET /idealize/bar/capabilities` reports no desktop shell, and posts to `/idealize/bar/minimode` as the rail button did.

**Session cards invert.** The agent's name is an 11px tertiary eyebrow; the summary is the 13px medium line. The hover card leads with the eyebrow, then the full summary, then the chat's space (`space.<id>`, the same dictionary the space lane's glyph uses), then time and status. Project groups are separated by a 1px `--dsw-alias-border-l1` rule with 6px above and below.

**The Session log export is an icon-only header control** (24px, which the header renders at its 28px control size), labelled by tooltip and `aria-label`, in `@deepseek-ai/dsh-session-log-export`'s own `HeaderAction`. JJ's item said "misplaced and too big"; this change fixes the size and the weight in place. Moving it (into the Trajectory pane, say) is a separate decision, not taken here.

**The terminal host's right padding is the paint margin minus 14px** (`gridPadding` in `TerminalView.tsx`, with the stylesheet default trimmed the same way). The fit addon counts columns from the host's width minus that 14px, so giving it back on the right puts the columns the same distance from both edges, give or take the sub-cell remainder, and xterm's overlay scrollbar rides inside the margin.

**The Service hatch's opening copy is a bubble, and "Open as a chat" is gone.** The header keeps its title, quote and source path but is styled as an assistant-side bubble at the head of the transcript, so it reads as the hatch's first message. The `service.open.main` action, its dictionary key, the `openInMain` injected callback and the section's `close` prop are deleted; the hatch stays a drawer pane.

**Brains rows are titled by what they make**: Images, Sounds, Video (zh 图片, 声音, 视频). "Roles" becomes "Project leadership" (项目负责人); "Agent roles" keeps its name. Both sections stay: one is the roster of agents a project can call on, the other says which agent is Lead and which is Project Coordinator.

## Alternatives considered

- **Keep the mini-mode toggle on the rail, at the bottom.** JJ asked for the chrome; the rail is a list of panes and the toggle restarts the app. Rejected.
- **Put the toggle in `sidebar.footer.action`.** That seat exists, but it sits at the foot beside Settings, not with the window controls. A new header seat was the honest reading of "next to the other window controls" in a shell whose window frame is native.
- **Move the Session log control into the Trajectory pane.** Plausible (the log is what Trajectory renders), but JJ's item is one line and the pane's own design is a later question; shrinking it in place answers the complaint without pre-empting that.
- **Hide the scrollbar with `scrollbar-width: none`, or widen the xterm element with a negative right margin.** Both were tried on the packaged window and moved nothing: xterm 6 draws its own overlay scrollbar, the fit addon subtracts a constant rather than a measurement, and the grid is left-aligned inside the element, so only the host width the addon reads can move the grid's right edge. Setting `scrollback: 0` would zero the term but would delete the buffer.
- **Rename "Agent roles" instead of "Roles".** "Agent roles" is the roster and the name reads correctly; "Roles" was the one that said nothing about leadership.

## Consequences

The rail's order and glyphs are pinned by `rail.client.spec.tsx`, which also asserts no rail button is labelled Mini mode. The sidebar's declared children include `sidebar.header.action` (apply and snapshot specs; the client slot catalog is regenerated). The group rule is pinned by `browser-styles.client.spec.ts`; the header action's test now describes the icon control. The Brains tests read the media rows as Images, Sounds and Video and the leadership table by its new name.

The bar's Appearance glyph no longer changes with the theme; the pane itself is unchanged. The hatch session can still be reached on the main surface through the sidebar like any other chat; only the shortcut button went.

The terminal fix was measured on the packaged window: before it, the xterm screen ended 20px short of its viewport on the right (14px scrollbar term plus the sub-cell remainder) with the paint margin at 36px each side. The packaged-window walk is the proof for everything visual here, per [packaged-window-proofing](../../../skills/packaged-window-proofing/SKILL.md).
