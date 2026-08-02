import SwiftUI
import AppKit

@main
struct IDEalizeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @ObservedObject private var workspace = Workspace.shared

    var body: some Scene {
        Window("IDEalize", id: "main") {
            WorkspaceView(workspace: workspace)
                .onAppear {
                    workspace.startIPCIfNeeded()
                    // Fold any legacy per-project flow libraries into the global one.
                    FlowStore.migrateLegacyLibrary()
                    // Check for a pushed announcement ("v0.x is ready", etc.) and
                    // surface it as a dismissible banner if it's new to this user.
                    AnnouncementStore.shared.refresh()
                    // Restore the session rail (Projects → Chats) from last launch.
                    if workspace.tabs.isEmpty {
                        workspace.restoreProjects()
                    }
                    // First run: drop straight into a chat (in Home) so the
                    // welcome card greets the user — no empty-screen dead end.
                    if !AppSettings.shared.hasSeenWelcome, workspace.tabs.isEmpty {
                        workspace.newTab(projectPath: FileManager.default.homeDirectoryForCurrentUser.path)
                    }
                    // First run: show the tour once the session's chat has come up,
                    // so the in-pane steps (mode toggle, input, skills) have real
                    // controls to point at. Steps whose target isn't on screen are
                    // dropped, so an early start would silently shorten the tour.
                    if !AppSettings.shared.hasSeenTour {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
                            workspace.showTour = true
                        }
                    }
                    // If the previous session ended in mini-mode, re-apply it now
                    // that the NSWindow exists. A short delay lets SwiftUI finish
                    // its initial window placement.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        MiniModeManager.shared.restoreIfNeeded()
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .commands { IDEalizeCommands(workspace: workspace) }

        Settings {
            SettingsView()
        }
    }
}

/// Menu / keyboard commands for tabs and splits.
struct IDEalizeCommands: Commands {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var miniMode = MiniModeManager.shared
    @ObservedObject private var settings = AppSettings.shared

    var body: some Commands {
        // The tour is otherwise unreachable once it has been seen — this is how you
        // get it back. Keyboard Shortcuts is the at-a-glance map of everything below.
        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") { workspace.showShortcutsHelp = true }
                .keyboardShortcut("/", modifiers: .command)
            Button("Show Tour") { workspace.showTour = true }
        }
        CommandGroup(replacing: .newItem) {
            Button("New Session…") { openProjectTab() }
                .keyboardShortcut("t", modifiers: .command)
            Button("New Session in Home") { workspace.newTab() }
                .keyboardShortcut("t", modifiers: [.command, .shift])
            Button("New Project…") { _ = workspace.newProject() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Menu("Open Recent") {
                let recents = AppSettings.shared.recentFolders
                if recents.isEmpty {
                    Button("No Recent Folders") {}.disabled(true)
                } else {
                    ForEach(recents, id: \.self) { path in
                        Button(abbreviate(path)) { workspace.newTab(projectPath: path) }
                    }
                    Divider()
                    Button("Clear Menu") { AppSettings.shared.recentFolders = [] }
                }
            }
        }
        CommandMenu("Terminal") {
            Button("Split Right") { workspace.splitFocused(axis: .horizontal) }
                .keyboardShortcut("d", modifiers: .command)
            Button("Split Down") { workspace.splitFocused(axis: .vertical) }
                .keyboardShortcut("d", modifiers: [.command, .shift])
            Divider()
            Button("Close Pane") { closeFocused() }
                .keyboardShortcut("w", modifiers: .command)
            Button("Archive Chat") { archiveSelected() }
                .keyboardShortcut(.delete, modifiers: [.command, .shift])
                .disabled(workspace.selectedTab == nil)
            Divider()
            // The two faces of a pane: reveal the raw terminal behind the chat,
            // or put the caret straight into the message input from anywhere.
            Button("Toggle Chat / Terminal") { toggleChatTerminal() }
                .keyboardShortcut("j", modifiers: .command)
            Button("Focus Message Input") { focusMessageInput() }
                .keyboardShortcut("i", modifiers: .command)
            Divider()
            Button("Next Session") { cycleTab(+1) }
                .keyboardShortcut("]", modifiers: [.command, .shift])
            Button("Previous Session") { cycleTab(-1) }
                .keyboardShortcut("[", modifiers: [.command, .shift])
            // ⌘1–⌘9 jump straight to a chat, in the rail's order.
            ForEach(Array(workspace.tabs.prefix(9).enumerated()), id: \.element.id) { pair in
                Button(pair.element.customName ?? pair.element.name) { jumpToTab(pair.element) }
                    .keyboardShortcut(KeyEquivalent(Character("\(pair.offset + 1)")), modifiers: .command)
            }
            Divider()
            Button("Copy Last Command") { copyLastCommand() }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Re-run Last Command") { rerunLast() }
                .keyboardShortcut("r", modifiers: [.control])
            Divider()
            Button(workspace.isProjectAgentOpen ? "Close Project Agent" : "Open Project Agent") {
                workspace.toggleProjectAgent()
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(!workspace.canOpenProjectAgent)
        }
        // Inject into the standard "View" menu rather than declaring our own
        // CommandMenu("View"): a second CommandMenu with that title sits alongside
        // AppKit's built-in View menu instead of merging, giving two "View" menus
        // in the bar. The .sidebar placement lands these items in the one real
        // View menu.
        CommandGroup(after: .sidebar) {
            Button(miniMode.isEnabled ? "Exit Mini Mode" : "Enter Mini Mode") {
                miniMode.toggle()
            }
            .keyboardShortcut("m", modifiers: [.control, .option])
            Divider()
            Button("Command Palette") { workspace.showCommandPalette.toggle() }
                .keyboardShortcut("p", modifiers: .command)
            Button(workspace.showSidebar ? "Hide Blocks Sidebar" : "Show Blocks Sidebar") {
                workspace.showSidebar.toggle()
            }
            .keyboardShortcut("b", modifiers: .command)
            Button(workspace.showComposer ? "Hide Command Composer" : "Show Command Composer") {
                workspace.showComposer.toggle()
            }
            .keyboardShortcut("l", modifiers: .command)
            Divider()
            // The three workspace panels, left to right: rail, explorer, document.
            Button(workspace.showSessionRail ? "Hide Sessions Rail" : "Show Sessions Rail") {
                workspace.showSessionRail.toggle()
            }
            .keyboardShortcut("r", modifiers: [.command, .shift])
            Button(workspace.showFileExplorer ? "Hide File Explorer" : "Show File Explorer") {
                workspace.showFileExplorer.toggle()
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
            Button(workspace.showViewer ? "Hide Document Panel" : "Show Document Panel") {
                workspace.showViewer.toggle()
            }
            .keyboardShortcut("v", modifiers: [.command, .shift])
            Button(workspace.showAppearance ? "Hide Appearance Panel" : "Show Appearance Panel") {
                workspace.showAppearance.toggle()
            }
            .keyboardShortcut("a", modifiers: [.command, .option])
            Divider()
            Button("Bigger Terminal Font") { bumpTerminalFont(+1) }
                .keyboardShortcut("=", modifiers: .command)
            Button("Smaller Terminal Font") { bumpTerminalFont(-1) }
                .keyboardShortcut("-", modifiers: .command)
            Button("Default Terminal Font") { settings.fontSize = AppearanceDefaults.fontSize }
                .keyboardShortcut("0", modifiers: .command)
        }
    }

    private func copyLastCommand() {
        guard let cmd = workspace.focusedSession?.blocks.last?.command else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(cmd, forType: .string)
    }

    private func rerunLast() {
        guard let session = workspace.focusedSession,
              let cmd = session.blocks.last?.command else { return }
        session.rerun(cmd)
    }

    /// Reveal the raw terminal behind the focused pane's chat (or tuck it away),
    /// mirroring the in-pane ModeToggle — same animation, same state.
    private func toggleChatTerminal() {
        guard let session = workspace.focusedSession else { return }
        withAnimation(LeafPaneView.modeAnim) { session.revealTerminal.toggle() }
    }

    /// Put the caret in the focused pane's message input. Falls back to the
    /// selected chat's first session when nothing holds terminal focus yet.
    private func focusMessageInput() {
        if workspace.focusedSessionID == nil, let s = workspace.selectedTab?.sessions.first {
            workspace.focusSession(s.id)
        }
        workspace.focusInputRequest += 1
    }

    private func archiveSelected() {
        guard let tab = workspace.selectedTab else { return }
        workspace.archiveTab(tab)
    }

    private func jumpToTab(_ tab: WorkspaceTab) {
        workspace.selectedTabID = tab.id
        if let s = tab.sessions.first { workspace.focusSession(s.id) }
    }

    /// Nudge the terminal font size (⌘= / ⌘-), clamped to the Appearance
    /// panel's sensible range. WorkspaceView reapplies it to live terminals.
    private func bumpTerminalFont(_ delta: Double) {
        settings.fontSize = min(28, max(9, settings.fontSize + delta))
    }

    private func closeFocused() {
        if let id = workspace.focusedSessionID, let s = workspace.session(withID: id) {
            workspace.closeSession(s)
        } else if let tab = workspace.selectedTab {
            workspace.closeTab(tab)
        }
    }

    private func cycleTab(_ delta: Int) {
        guard !workspace.tabs.isEmpty,
              let current = workspace.selectedTabID,
              let idx = workspace.tabs.firstIndex(where: { $0.id == current }) else { return }
        let next = (idx + delta + workspace.tabs.count) % workspace.tabs.count
        let tab = workspace.tabs[next]
        workspace.selectedTabID = tab.id
        if let s = tab.sessions.first { workspace.focusSession(s.id) }
    }

    private func openProjectTab() {
        workspace.newTabPickingFolder()
    }

    private func abbreviate(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) { return "~" + path.dropFirst(home.count) }
        return path
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Dev build: its own runtime dir (see IPC.socketPath) so it runs alongside
        // the installed app without fighting over the socket/token. Ensure the dir
        // exists before the IPC hub binds its socket.
        if Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true {
            try? FileManager.default.createDirectory(
                atPath: NSHomeDirectory() + "/Library/Application Support/IDEalize Dev",
                withIntermediateDirectories: true)
        }
        NSApp.setActivationPolicy(.regular)
        Fonts.registerBundled()   // make the bundled DM Mono resolvable app-wide
        applyDockIcon()
        NotificationManager.shared.requestAuthorization()
        SpeechDictation.shared.requestAuthorization()
        // Push the Flow companion skill/commands into ~/.claude so every project
        // the user opens can review and run Flows (idempotent, version-checked).
        // Claude-only for now; other agents get flow support via their own adapters.
        FlowSkillInstaller.install()
        // Pre-accept Claude Code's one-time "Bypass Permissions mode" gate so the
        // default `--dangerously-skip-permissions` launch doesn't hang a fresh machine
        // on a dialog we type past but never answer. Runs before any chat spawns Claude.
        ClaudeConfigBootstrap.ensureBypassPermissionsAccepted()
        // Repoint the `idealize` shim at this build's CLI now rather than waiting
        // for the first shell to spawn, so an installed app heals a shim left
        // dangling or hijacked by some other bundle. A non-installed build only
        // ever touches its own private bin dir (see CLIInstaller).
        CLIInstaller.installShim()
        Workspace.shared.startIPCIfNeeded()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Set the Dock icon. The bundle's Info.plist handles this for installed
    /// apps; this also covers `swift run` (dev) and forces an immediate update.
    private func applyDockIcon() {
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("AppIcon.icns").path,
            FileManager.default.currentDirectoryPath + "/Resources/AppIcon.icns",
        ].compactMap { $0 }
        if let path = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }),
           let image = NSImage(contentsOfFile: path) {
            NSApp.applicationIconImage = image
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    /// Clicking the Dock icon brings the app back. A minimised window isn't
    /// "visible", and SwiftUI's `Window` scene doesn't deminiaturize itself — so
    /// without this the window stays in the Dock and the app looks like it has
    /// vanished.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        guard !hasVisibleWindows else { return true }
        for window in sender.windows where window.isMiniaturized {
            window.deminiaturize(nil)
        }
        sender.windows.first { $0.identifier?.rawValue == "main" }?.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Flush any pending (debounced) rail snapshot before we tear down, so a
        // change made just before quit still restores on next launch.
        Workspace.shared.flushSnapshotSave()
        Workspace.shared.ipcHub?.stop()
        Workspace.shared.allSessions.forEach { $0.terminate() }
    }
}
