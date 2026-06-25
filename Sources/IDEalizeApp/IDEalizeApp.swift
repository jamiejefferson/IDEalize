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
                    // First run: drop straight into a chat (in Home) so the
                    // welcome card greets the user — no empty-screen dead end.
                    if !AppSettings.shared.hasSeenWelcome, workspace.tabs.isEmpty {
                        workspace.newTab(projectPath: FileManager.default.homeDirectoryForCurrentUser.path)
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
    let workspace: Workspace

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Session…") { openProjectTab() }
                .keyboardShortcut("t", modifiers: .command)
            Button("New Session in Home") { workspace.newTab() }
                .keyboardShortcut("t", modifiers: [.command, .shift])
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
            Divider()
            Button("Next Session") { cycleTab(+1) }
                .keyboardShortcut("]", modifiers: [.command, .shift])
            Button("Previous Session") { cycleTab(-1) }
                .keyboardShortcut("[", modifiers: [.command, .shift])
            Divider()
            Button("Copy Last Command") { copyLastCommand() }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Re-run Last Command") { rerunLast() }
                .keyboardShortcut("r", modifiers: [.control])
        }
        CommandMenu("View") {
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
        NSApp.setActivationPolicy(.regular)
        applyDockIcon()
        NotificationManager.shared.requestAuthorization()
        SpeechDictation.shared.requestAuthorization()
        // Push the Flow companion skill/commands into ~/.claude so every project
        // the user opens can review and run Flows (idempotent, version-checked).
        FlowSkillInstaller.install()
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

    func applicationWillTerminate(_ notification: Notification) {
        Workspace.shared.ipcHub?.stop()
        Workspace.shared.allSessions.forEach { $0.terminate() }
    }
}
