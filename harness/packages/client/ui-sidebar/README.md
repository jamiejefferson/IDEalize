# @deepseek-ai/dsh-client-ui-sidebar

Sidebar shell plugin: the wordmark, New Session action, layout-owned collapse control, scroll-aware region seat, and bottom-pinned Settings seat. [ui-workspace](../ui-workspace/README.md) owns the Workspace and Session browser rendered into `sidebar.workspaces`; this package neither derives its rows nor owns its view preferences. Collapse into the layout-owned 56px rail remains presentation-local. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

New Session starts the runtime's page-local frontend Session Intent. The runtime targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page. Workspace-specific controls and the shared picker belong to ui-workspace.

`SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared `sidebar.workspaces`, `sidebar.settings`, `sidebar.footer.action`, `sidebar.header.action` and `sidebar.rail` child slots, injected `startSession` plus sidebar-toggle callbacks, and the injected `useRailOccupied` hook, which reads the rail seat's occupancy off the slot registry. There is no plugin store.

`sidebar.rail` is a single root seat for the collapsed column's browsing region. While the column is collapsed and the seat has a registrant, the shell renders that registrant between the New chat control and the foot in place of `sidebar.workspaces`, handing it `expandSidebar`; wide, or with the seat empty, `sidebar.workspaces` renders at the same slot position it always did, so a composition without a registrant keeps the browser's own icon column and never remounts it across a collapse. IDEalize's `@idealize/askbar` seats its agent rail here so the collapsed sidebar shows what the floating Askbar shows.

During a live collapse, the shell holds the expanded content at its current width while it fades out for 150ms. The four upper controls—the shell toggle and New Session plus add and search rendered through `sidebar.workspaces`—then share one 150ms fade and 49px leftward translation into the 56px rail, ending with the layout's 300ms column slide; every 36px control box follows the same path to the rail's 10px left inset. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region ([ui-workspace](../ui-workspace/README.md)), so revealing a thumb never reflows.

The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`); ui-settings registers the trigger row and settings panel there. `sidebar.header.action` is a list seat in the header's control stack, rendered on the collapse toggle's row, left of it, while the sidebar is wide, for window-level controls other plugins own (IDEalize's desktop mini-mode toggle); each occupant receives only `wide`.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session state-dot rendering is owned by [ui-workspace](../ui-workspace/README.md)** — no done/error notification sources are available.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to [ui-workspace](../ui-workspace/README.md), not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
