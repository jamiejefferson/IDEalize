IDEalize
Mini-Mode
Product & Technical Specification
A compact, side-by-side working mode for single-screen development

Version 0.1 (draft)     Owner JJ     Date 16 July 2026     Status For review
 1. Overview
Mini-mode is a compact display state for the IDEalize desktop application. When a developer is working on a single screen, they typically want IDEalize visible alongside the app or browser they are building, not competing with it for space. Mini-mode shrinks IDEalize to a narrow, docked column that occupies roughly a fifth of the screen width, strips the interface back to the essentials, and reflows the layout into a mobile-style pattern so the whole app remains usable at that width.
The mode is a single toggle. Entering it stores the current window state, resizes and docks the window, and switches the interface to a compact layout. Leaving it restores the window to exactly where and how it was. Because IDEalize is a desktop application, the window can reposition and resize itself; the one thing it cannot do is move a separate browser window, so the design leans on docking plus the operating system's own snapping to achieve the side-by-side result.
Goals
•	Let a developer keep IDEalize permanently visible beside their work on a single monitor.
•	Reduce IDEalize to the smallest genuinely useful footprint without losing access to any feature.
•	Make entering and leaving the mode instant, predictable, and non-destructive to the user's window arrangement.
Non-goals
•	Automatically tiling or resizing the user's browser or other applications (not achievable reliably across operating systems).
•	A separate mobile or web build. Mini-mode is a responsive state of the existing desktop app, not a new client.
•	Multi-monitor orchestration. This spec targets the single-screen case; multi-monitor is noted as a future consideration.
2. Problem & primary use case
On a single screen, running IDEalize at its normal size forces the user to alt-tab between it and whatever they are building. That breaks the flow of referring to a chat, applying a change, and checking the result. The developer wants both surfaces on screen at once.
Primary scenario: a developer has a browser or their target application maximised, and wants IDEalize pinned down one side of the screen as a slim column they can glance at, scroll through, and type into, without it ever getting buried or eating more than about a fifth of the display.
3. Platform constraints — what tiling can and cannot do
IDEalize is a desktop application (Electron / Tauri-class wrapper), which determines what is realistic:
•	Achievable: The IDEalize window can resize itself, reposition to a screen edge, set itself to a fixed fraction of the screen width, and optionally stay always-on-top. It can remember its previous bounds and restore them.
•	Not achievable: The app cannot force a separate browser or third-party window to occupy the remaining space. No cross-platform API lets one application reposition another's windows for the user.
Design consequence: mini-mode docks IDEalize to one screen edge at roughly one-fifth width and full height. The remaining four-fifths is filled either by the user snapping their browser beside it (a single drag or keyboard shortcut on both Windows and macOS) or simply by leaving a maximised window behind an always-on-top IDEalize column. This delivers the side-by-side result without fighting the operating system.
4. Scope
In scope	Out of scope (for v1)
Mini-mode toggle in the app navigation menu	Toolbar/interface-level toggle button
Self-resizing, docking and restore of the IDEalize window	Moving or resizing other applications' windows
Compact mobile-style layout at narrow width	A distinct mobile/web build
Chat list + current chat as the primary panel	New chat features unique to mini-mode
Secondary panels as slide-outs / swipe views	Redesigning the panels' full-size behaviour
Bottom navigation toolbar	Multi-monitor placement logic
Dock side and always-on-top preferences	Custom width beyond a small preset range
5. Functional requirements
5.1 Entry point & toggle
•	Mini-mode is toggled from the application navigation menu (e.g. View menu), deliberately not from the main interface, to keep the compact view uncluttered.
•	A keyboard shortcut is assigned so power users can flip in and out without the menu (proposed default noted in Open questions).
•	Within mini-mode, a single, small affordance to exit is present (e.g. an item in the bottom toolbar's overflow), so the user is never trapped if the menu bar is not visible.
•	The toggle is a true state, remembered across sessions: if the user quits while in mini-mode, IDEalize reopens in mini-mode.
5.2 Window behaviour
On entering mini-mode:
1.	Capture and persist the current window bounds (x, y, width, height) and maximised/normal state.
2.	Resize the window to a target of roughly one-fifth of the current screen's working width, full working height.
3.	Reposition (dock) the window to the preferred screen edge (default right; user-configurable).
4.	Optionally set always-on-top, per user preference (default on).
5.	Apply a sensible minimum width so the compact layout never collapses below usability, and clamp the target if the screen is unusually small.
On leaving mini-mode:
6.	Clear always-on-top.
7.	Restore the exact stored bounds and maximised state captured on entry.
The capture-and-restore behaviour is essential: it makes the feature feel safe rather than destructive, so users trust the toggle.
5.3 Compact layout
•	Below a defined width breakpoint, the interface switches to a mobile-style single-column layout — the same responsive machinery a phone viewport would use.
•	Chrome is minimised: reduced padding, condensed headers, icon-first controls, hidden non-essential toolbars.
•	Everything remains reachable; nothing is removed, only reorganised into slide-outs and the bottom toolbar.
5.4 Primary panel — chats
•	The primary panel shows a way to move between chats plus the current chat, so the user can jump through conversations and stay in the active one.
•	Chat navigation is compact — a list, switcher, or collapsible header the user can open to pick a chat, then return to the conversation.
•	The current chat (messages + composer) is the default focus when mini-mode opens.
5.5 Secondary panels — slide-outs
•	Panels that sit beside the chat at full size become slide-outs or swipeable views in mini-mode, in the manner of a mobile app (pan left / right, or slide over).
•	Each secondary panel is reachable from the bottom toolbar and dismissible back to the chat with an obvious gesture or control.
•	Only one panel is visible at a time; opening a panel overlays or replaces the chat view rather than splitting the narrow column.
5.6 Bottom toolbar
•	A mobile-style toolbar pinned to the bottom of the view provides the primary navigation between the chat view and each secondary panel.
•	Items are icon-first with clear active states; an overflow holds anything that does not fit, including the exit-mini-mode control.
•	The toolbar is always visible in mini-mode so navigation is one tap away regardless of which view is open.
6. Interaction & transitions
•	Entering and leaving mini-mode animates smoothly (window resize plus layout reflow) rather than snapping abruptly, so the change reads as one deliberate action.
•	Scroll position and the active chat are preserved across the transition in both directions where practical.
•	If always-on-top is enabled, IDEalize floats above other windows but never steals focus on its own.
•	Resizing the window manually while in mini-mode is allowed; the layout stays in its compact state as long as the width is below the breakpoint.
7. Settings & preferences
Preference	Default	Notes
Dock side	Right	Left or right screen edge.
Always-on-top	On	Keeps IDEalize visible over the browser.
Target width	~20% of screen	Small preset range, clamped by a minimum.
Remember mode on quit	On	Reopen in mini-mode if quit in mini-mode.
Keyboard shortcut	TBD	Global toggle in and out.
8. Edge cases
•	Very small screens: if one-fifth width falls below the usable minimum, clamp to the minimum width and accept a larger fraction.
•	Screen resolution or arrangement changes while docked: re-clamp and re-dock to keep the window fully on-screen.
•	Multi-monitor: v1 docks on the screen the window currently occupies; smarter placement is deferred.
•	A secondary panel needing more width than the column allows: it takes over the full column as an overlay rather than truncating.
•	Restore after a crash: persisted pre-mini-mode bounds should survive so the user can recover their previous window size.
9. Non-functional requirements
•	Transitions complete quickly (sub-300ms target) with no visible layout thrash.
•	Compact layout reuses existing responsive components; no parallel UI codebase.
•	Window state and preferences persist reliably across sessions and app updates.
•	Mini-mode adds no measurable idle CPU cost from always-on-top.
10. Suggested build phases
A phased approach so value lands early and the risky bits are isolated:
Phase	Deliverable
1 — Window mechanics	Toggle in the nav menu; capture bounds, resize to ~1/5 width, dock right, restore on exit. No layout change yet.
2 — Compact layout	Responsive breakpoint drives the mobile-style single-column view; primary chat panel (list + current chat).
3 — Panels & toolbar	Secondary panels as slide-outs; bottom navigation toolbar; exit control in overflow.
4 — Polish	Always-on-top, dock-side preference, keyboard shortcut, transitions, persistence across sessions.
11. Open questions
•	What is the exact width breakpoint and minimum width that keep the compact layout comfortable?
•	Which secondary panels exist today, and what is their priority order in the bottom toolbar?
•	Default keyboard shortcut for the toggle?
•	Should always-on-top default on or off — floating column, or simply a docked narrow window?
•	On multi-monitor setups, is there a preferred screen for docking, or always the current one?
12. Recommended first step
Start with Phase 1 and nothing else. In the main window/process file, find where the window is created (the setBounds / window options). That single location is where mini-mode hooks in. Add: on toggle, store the current bounds, then set the window to roughly one-fifth width, full height, docked to the right; on toggle off, restore the stored bounds. Prove the resize-and-restore works before any layout work begins — it de-risks the whole feature in well under an hour.
