import SwiftUI
import AppKit
import IDEalizeCore

/// A node in a tab's split tree. A node is either a leaf (one terminal) or a
/// split with an axis and child nodes.
final class PaneNode: ObservableObject, Identifiable {
    let id = UUID()
    @Published var session: TerminalSession?
    @Published var axis: Axis = .horizontal
    @Published var children: [PaneNode] = []

    var isLeaf: Bool { session != nil }

    init(session: TerminalSession) { self.session = session }
    init(axis: Axis, children: [PaneNode]) { self.axis = axis; self.children = children }

    /// All terminal sessions under this node.
    func collectSessions(into out: inout [TerminalSession]) {
        if let s = session { out.append(s) }
        children.forEach { $0.collectSessions(into: &out) }
    }
}

/// A tab: a name plus a split tree of terminals.
final class WorkspaceTab: ObservableObject, Identifiable {
    let id = UUID()
    @Published var root: PaneNode
    @Published var name: String
    /// User-set name (right-click → Rename); overrides the smart folder name.
    @Published var customName: String?

    init(root: PaneNode, name: String) { self.root = root; self.name = name }

    /// The smart name: the user's custom name, else the primary terminal's
    /// folder name, else the stored name.
    var displayName: String {
        if let c = customName, !c.isEmpty { return c }
        if let p = sessions.first?.projectPath, !p.isEmpty, p != "/" {
            return (p as NSString).lastPathComponent
        }
        return name
    }

    var sessions: [TerminalSession] {
        var out: [TerminalSession] = []
        root.collectSessions(into: &out)
        return out
    }

    /// Any session in this chat has something new for you — drives the bold-text
    /// unread signal in the rail.
    var hasUnread: Bool { sessions.contains { $0.needsAttention } }
}

/// Top-level model for one window: owns tabs, the focused session, and brokers
/// IPC requests against the live session registry.
final class Workspace: ObservableObject {
    @Published var tabs: [WorkspaceTab] = []
    @Published var selectedTabID: WorkspaceTab.ID?
    @Published var focusedSessionID: String?

    // UI surfaces (Warp-style).
    @Published var showCommandPalette = false
    @Published var showSidebar = false
    @Published var showComposer = true
    /// Left vertical session rail and middle file-explorer panel.
    @Published var showSessionRail = true
    @Published var showFileExplorer = true
    /// Tab currently being dragged in the rail (for reordering).
    var draggingTabID: WorkspaceTab.ID?
    /// File currently shown/edited in the document panel.
    @Published var viewedFile: URL?
    /// Whether the document panel is shown (it can be open with no file → CTA).
    @Published var showViewer: Bool = false
    /// Whether the in-view Appearance panel is shown.
    @Published var showAppearance: Bool = false
    /// Whether the first-run showcase is on screen. Transient — whether it has
    /// *been* seen is `AppSettings.hasSeenTour`.
    @Published var showTour: Bool = false
    /// Which panel the Appearance editor is currently targeting.
    @Published var appearanceTarget: PanelKind = .chat
    /// Bumped when files change on disk so the file explorer reloads.
    @Published var fileTreeVersion: Int = 0

    /// Create a new markdown document in the focused session's directory and open
    /// it for editing. Returns the new file's URL (nil on failure).
    @discardableResult
    func createDocument(named rawName: String) -> URL? {
        let dir = focusedSession?.projectPath.flatMap { $0.isEmpty || $0 == "/" ? nil : $0 }
            ?? FileManager.default.homeDirectoryForCurrentUser.path
        var name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { name = "untitled" }
        if (name as NSString).pathExtension.isEmpty { name += ".md" }
        var url = URL(fileURLWithPath: dir).appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            let base = (name as NSString).deletingPathExtension
            let ext = (name as NSString).pathExtension
            url = URL(fileURLWithPath: dir).appendingPathComponent("\(base)-\(n).\(ext)")
            n += 1
        }
        do {
            try "".write(to: url, atomically: true, encoding: .utf8)
            viewedFile = url
            showViewer = true
            fileTreeVersion += 1   // make the new file appear in the explorer
            return url
        } catch { return nil }
    }
    /// The open project's root folder, if a real one is open.
    var projectRootURL: URL? {
        guard let p = focusedSession?.projectPath, !p.isEmpty, p != "/" else { return nil }
        return URL(fileURLWithPath: p)
    }

    /// Show `path` in the file explorer: expand its folders, scroll to it and
    /// select it. If the file belongs to a different project than the focused
    /// one, that project's terminal is focused first so its tree is on screen.
    /// `open` also loads the file into the document panel.
    ///
    /// This is what `idealize reveal` calls, so an agent can point the human at
    /// a file it just wrote or wants to talk about.
    func reveal(path: String, open: Bool) -> IPCResponse {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .failure("no such file: \(url.path)")
        }
        guard let owner = sessionOwning(url) else {
            return .failure("\(url.path) isn't inside any folder open in IDEalize")
        }
        // The tree never lists dotfiles, so it can't scroll to one. Only the part
        // of the path *below* the root matters — the root itself is free to live
        // somewhere hidden, like ~/.config/something.
        let root = URL(fileURLWithPath: owner.explorerRoot).standardizedFileURL.path
        let relative = url.path.dropFirst(root.count)
        if let hidden = relative.split(separator: "/").first(where: { $0.hasPrefix(".") }) {
            return .failure("'\(hidden)' is hidden — the file explorer doesn't show hidden files")
        }
        if owner.id != focusedSessionID { focusSession(owner.id) }
        showFileExplorer = true
        if open {
            viewedFile = url
            showViewer = true
        }
        FileReveal.shared.reveal(url, open: open)
        return IPCResponse(ok: true, info: "revealed \(url.lastPathComponent) in \(owner.label)")
    }

    /// The session whose explorer tree contains `url`. The focused session wins
    /// ties, so revealing a file in a project that's open in two tabs doesn't yank
    /// the user off to the other one.
    private func sessionOwning(_ url: URL) -> TerminalSession? {
        func contains(_ session: TerminalSession) -> Bool {
            let root = URL(fileURLWithPath: session.explorerRoot).standardizedFileURL.path
            return url.path == root || url.path.hasPrefix(root + "/")
        }
        if let focused = focusedSession, contains(focused) { return focused }
        return allSessions.first(where: contains)
    }

    /// Copy files or folders from anywhere on disk into `destination` (a folder in
    /// the open project). Originals are left untouched; a name clash becomes
    /// `hero-2.png`. Returns the URLs actually written.
    @discardableResult
    func copyIntoProject(_ sources: [URL], destination: URL) -> [URL] {
        var written: [URL] = []
        var failed = false
        for source in sources {
            // Dropping something back onto the folder it already lives in means
            // "no thanks", not "duplicate it".
            guard source.deletingLastPathComponent().standardizedFileURL != destination.standardizedFileURL
            else { continue }
            // Copying a folder into its own subtree would recurse forever.
            guard !destination.standardizedFileURL.path.hasPrefix(source.standardizedFileURL.path + "/")
            else { continue }
            let target = uniqueURL(for: source, in: destination)
            do {
                try FileManager.default.copyItem(at: source, to: target)
                written.append(target)
            } catch {
                failed = true
                NSLog("IDEalize: copy \(source.path) → \(target.path) failed: \(error)")
            }
        }
        if failed { NSSound.beep() }
        if !written.isEmpty { fileTreeVersion += 1 }   // show the arrivals in the tree
        return written
    }

    /// `dir/name.ext`, suffixed `-2`, `-3`… until it names nothing that exists.
    private func uniqueURL(for source: URL, in dir: URL) -> URL {
        var candidate = dir.appendingPathComponent(source.lastPathComponent)
        let base = (source.lastPathComponent as NSString).deletingPathExtension
        let ext = source.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            let name = ext.isEmpty ? "\(base)-\(n)" : "\(base)-\(n).\(ext)"
            candidate = dir.appendingPathComponent(name)
            n += 1
        }
        return candidate
    }

    /// When set, the workflow parameter sheet is presented.
    @Published var pendingWorkflow: Workflow?

    var focusedSession: TerminalSession? {
        focusedSessionID.flatMap { session(withID: $0) } ?? selectedTab?.sessions.first
    }

    let settings: AppSettings
    private(set) var ipcHub: IPCHub?

    /// Single shared registry so terminals across all tabs/panes (and projects)
    /// can address one another over IPC.
    static let shared = Workspace()

    init(settings: AppSettings = .shared) {
        self.settings = settings
    }

    /// Start the IPC hub once (first window). Safe to call repeatedly.
    func startIPCIfNeeded() {
        guard ipcHub == nil else { return }
        let hub = IPCHub { [weak self] request in
            // Hub runs on a background queue; mutate model on main.
            var response = IPCResponse.failure("workspace gone")
            let work = { response = self?.handle(request) ?? .failure("workspace gone") }
            if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
            return response
        }
        do {
            try hub.start()
            self.ipcHub = hub
        } catch {
            NSLog("IDEalize: failed to start IPC hub: \(error)")
        }
    }

    var selectedTab: WorkspaceTab? {
        tabs.first { $0.id == selectedTabID }
    }

    /// Every live session across all tabs.
    var allSessions: [TerminalSession] {
        tabs.flatMap { $0.sessions }
    }

    func session(withID id: String) -> TerminalSession? {
        allSessions.first { $0.id == id }
    }

    // MARK: - Tab / pane management

    @discardableResult
    func newTab(projectPath: String? = nil,
                launchOverride: String? = nil,
                suppressAutoLaunch: Bool = false) -> TerminalSession {
        if let projectPath { settings.addRecentFolder(projectPath) }
        let session = makeSession(projectPath: projectPath,
                                  launchOverride: launchOverride,
                                  suppressAutoLaunch: suppressAutoLaunch)
        let tab = WorkspaceTab(root: PaneNode(session: session), name: session.label)
        // Keep a project's chats contiguous in `tabs`: insert a new chat right
        // after the last existing chat of the same project, else append. The rail
        // groups by first-appearance order, so contiguity is what stops a
        // within-project drag-reorder from reshuffling the whole project list.
        let key = normalizedProjectKey(projectPath)
        if let lastSameProject = tabs.lastIndex(where: { projectKey(for: $0) == key }) {
            tabs.insert(tab, at: lastSameProject + 1)
        } else {
            tabs.append(tab)
        }
        selectedTabID = tab.id
        focusedSessionID = session.id
        bindName(tab, to: session)
        scheduleSnapshotSave()
        return session
    }

    /// Open a Finder folder picker and start a new terminal tab there.
    @discardableResult
    func newTabPickingFolder() -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true   // show Finder's "New Folder" button
        panel.prompt = "Open Terminal Here"
        panel.message = "Choose a folder for the new terminal"
        if panel.runModal() == .OK, let url = panel.url {
            newTab(projectPath: url.path)
            return true
        }
        return false
    }

    /// Create a brand-new project folder via a Finder save dialog, then open a
    /// terminal tab rooted in it.
    @discardableResult
    func newProject() -> Bool {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.title = "New Project"
        panel.prompt = "Create"
        panel.message = "Choose a location and name for your new project folder"
        panel.nameFieldLabel = "Project name:"
        panel.nameFieldStringValue = "Untitled Project"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        } catch {
            NSSound.beep()
            return false
        }
        newTab(projectPath: url.path)
        return true
    }

    private func makeSession(projectPath: String?,
                             launchOverride: String? = nil,
                             suppressAutoLaunch: Bool = false) -> TerminalSession {
        let session = TerminalSession(settings: settings, workspace: self, projectPath: projectPath)
        session.launchOverride = launchOverride
        session.suppressAutoLaunch = suppressAutoLaunch
        session.onFocusRequested = { [weak self] sid in self?.focusSession(sid) }
        session.onUserFocused = { [weak self] sid in self?.setFocusedFromUserInteraction(sid) }
        session.start()
        return session
    }

    /// Open a "service hatch": a new tab rooted in IDEalize's own source, dropping
    /// straight into a Claude dev session (permissions skipped, vault docs in scope)
    /// preloaded with the `/idealize-service-hatch` safe-editing guide. Beeps if the
    /// source checkout can't be located.
    func openServiceHatch() {
        guard let repo = ServiceHatch.repoRoot() else { NSSound.beep(); return }
        let session = newTab(projectPath: repo, launchOverride: ServiceHatch.launchCommand())
        session.isServiceHatch = true   // shows the themed opening banner in the chat
    }

    /// The currently open service-hatch session, if any (searches every tab).
    var serviceHatchSession: TerminalSession? {
        tabs.lazy.flatMap { $0.sessions }.first { $0.isServiceHatch }
    }

    /// Whether a service hatch is currently open — drives the toolbar button's
    /// highlighted state.
    var isServiceHatchOpen: Bool { serviceHatchSession != nil }

    /// Toggle the service hatch: open one if none is open, otherwise close the
    /// open one. Lets the toolbar button act as an on/off switch.
    func toggleServiceHatch() {
        if let hatch = serviceHatchSession {
            closeSession(hatch)
        } else {
            openServiceHatch()
        }
    }

    /// Keep the tab name following the focused terminal's label.
    private func bindName(_ tab: WorkspaceTab, to session: TerminalSession) {
        tab.name = session.label
    }

    /// Split the currently focused pane along an axis, adding a new terminal.
    func splitFocused(axis: Axis) {
        guard let tab = selectedTab,
              let focused = focusedSessionID,
              let node = findLeaf(in: tab.root, sessionID: focused) else {
            // No focus: just add a tab.
            newTab()
            return
        }
        let newSession = makeSession(projectPath: node.session?.projectPath)
        let movedLeaf = PaneNode(session: node.session!)
        movedLeaf.onCopyFocus(from: node)
        let newLeaf = PaneNode(session: newSession)
        // Convert the focused leaf into a split in place.
        node.session = nil
        node.axis = axis
        node.children = [movedLeaf, newLeaf]
        tab.objectWillChange.send()
        focusedSessionID = newSession.id
    }

    /// Close a session: remove its leaf, collapse single-child splits, and drop
    /// empty tabs.
    func closeSession(_ session: TerminalSession) {
        // If the session is a tab's sole (root) terminal, close the whole tab —
        // `removeLeaf` only inspects child nodes, not the root leaf itself.
        if let tab = tabs.first(where: { $0.root.session?.id == session.id }) {
            closeTab(tab)
            return
        }
        session.terminate()
        for tab in tabs {
            if removeLeaf(in: tab.root, sessionID: session.id, parent: nil) {
                collapse(tab.root)
                break
            }
        }
        // Drop tabs that have no sessions left.
        tabs.removeAll { $0.sessions.isEmpty }
        if selectedTab == nil { selectedTabID = tabs.last?.id }
        if let next = selectedTab?.sessions.first { focusedSessionID = next.id }
        scheduleSnapshotSave()
        objectWillChange.send()
    }

    func closeTab(_ tab: WorkspaceTab) {
        tab.sessions.forEach { $0.terminate() }
        tabs.removeAll { $0.id == tab.id }
        if selectedTabID == tab.id { selectedTabID = tabs.last?.id }
        if let next = selectedTab?.sessions.first { focusedSessionID = next.id }
        scheduleSnapshotSave()
    }

    func sessionDidTerminate(_ session: TerminalSession) {
        // If a shell exits on its own, clean up its pane.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            for tab in self.tabs where tab.sessions.contains(where: { $0.id == session.id }) {
                _ = self.removeLeaf(in: tab.root, sessionID: session.id, parent: nil)
                self.collapse(tab.root)
            }
            self.tabs.removeAll { $0.sessions.isEmpty }
            if self.selectedTab == nil { self.selectedTabID = self.tabs.last?.id }
            self.scheduleSnapshotSave()
            self.objectWillChange.send()
        }
    }

    /// Update focus state from a user click/keystroke without forcing first
    /// responder again (avoids a feedback loop with the poll timer).
    func setFocusedFromUserInteraction(_ id: String) {
        guard focusedSessionID != id else { return }
        if let tab = tabs.first(where: { t in t.sessions.contains { $0.id == id } }) {
            if selectedTabID != tab.id { selectedTabID = tab.id }
        }
        focusedSessionID = id
        session(withID: id)?.markRead()
    }

    func focusSession(_ id: String) {
        guard let tab = tabs.first(where: { t in t.sessions.contains { $0.id == id } }) else { return }
        selectedTabID = tab.id
        focusedSessionID = id
        if let s = session(withID: id) {
            s.markRead()
            DispatchQueue.main.async { s.terminalView.window?.makeFirstResponder(s.terminalView) }
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Run a command in the focused terminal (executes immediately).
    func run(command: String) {
        focusedSession?.rerun(command)
    }

    /// Execute a workflow: if it needs parameters, present the sheet; else run.
    func execute(workflow: Workflow) {
        if workflow.detectedParameters.isEmpty {
            run(command: workflow.command)
        } else {
            pendingWorkflow = workflow
        }
    }

    func finishWorkflow(_ workflow: Workflow, values: [String: String]) {
        run(command: workflow.resolved(with: values))
        pendingWorkflow = nil
    }

    /// Re-apply theme/font to every live terminal (called when settings change).
    func reapplyAppearance() {
        let theme = settings.theme
        let font = settings.resolvedFont()
        for s in allSessions {
            s.applyTheme(theme, font: font)
        }
    }

    // MARK: - Tree helpers

    private func findLeaf(in node: PaneNode, sessionID: String) -> PaneNode? {
        if node.session?.id == sessionID { return node }
        for child in node.children {
            if let found = findLeaf(in: child, sessionID: sessionID) { return found }
        }
        return nil
    }

    @discardableResult
    private func removeLeaf(in node: PaneNode, sessionID: String, parent: PaneNode?) -> Bool {
        for (idx, child) in node.children.enumerated() {
            if child.session?.id == sessionID {
                node.children.remove(at: idx)
                return true
            }
            if removeLeaf(in: child, sessionID: sessionID, parent: node) { return true }
        }
        return false
    }

    /// Collapse splits that have a single child up into their parent.
    private func collapse(_ node: PaneNode) {
        for child in node.children { collapse(child) }
        if node.children.count == 1, let only = node.children.first {
            node.session = only.session
            node.axis = only.axis
            node.children = only.children
        }
    }

    // MARK: - Projects (rail grouping)

    /// A project: a folder path that one or more chats (tabs) live in. Built
    /// fresh from `tabs` for the rail — the grouping key is the tab's primary
    /// session's `projectPath` (folders with no project fall under Home).
    struct ProjectGroup: Identifiable {
        let path: String
        var tabs: [WorkspaceTab]
        var id: String { path }

        var isHome: Bool { path == FileManager.default.homeDirectoryForCurrentUser.path }
        var displayName: String {
            if isHome || path.isEmpty || path == "/" { return "Home" }
            return (path as NSString).lastPathComponent
        }
    }

    /// The grouping key for a tab: its primary session's project folder, or Home
    /// when it has none yet.
    func projectKey(for tab: WorkspaceTab) -> String {
        normalizedProjectKey(tab.sessions.first?.projectPath)
    }

    /// Normalise a raw project path to a grouping key (nil/empty/"/" → Home).
    func normalizedProjectKey(_ path: String?) -> String {
        let p = path ?? ""
        if p.isEmpty || p == "/" { return FileManager.default.homeDirectoryForCurrentUser.path }
        return p
    }

    /// How a chat is labelled in the rail and in the agent-facing shared note.
    /// A custom name wins; otherwise an un-renamed chat would fall back to the
    /// folder name (which the project header already shows), so give it a
    /// distinct "Chat N" by its position within the project. One source of truth
    /// so the rail and `idealize note` never disagree.
    func chatLabel(_ tab: WorkspaceTab, index: Int) -> String {
        if let c = tab.customName, !c.isEmpty { return c }
        return "Chat \(index + 1)"
    }

    /// Tabs bucketed into projects, in first-appearance order (chats keep their
    /// order within a project).
    var projectGroups: [ProjectGroup] {
        var order: [String] = []
        var buckets: [String: [WorkspaceTab]] = [:]
        for tab in tabs {
            let key = projectKey(for: tab)
            if buckets[key] == nil { order.append(key); buckets[key] = [] }
            buckets[key]?.append(tab)
        }
        return order.map { ProjectGroup(path: $0, tabs: buckets[$0] ?? []) }
    }

    // MARK: Collapse state

    func isCollapsed(_ path: String) -> Bool { settings.collapsedProjects.contains(path) }

    func toggleCollapsed(_ path: String) {
        if let i = settings.collapsedProjects.firstIndex(of: path) {
            settings.collapsedProjects.remove(at: i)
        } else {
            settings.collapsedProjects.append(path)
        }
        objectWillChange.send()
        scheduleSnapshotSave()
    }

    // MARK: Rename

    /// Rename a chat (tab) and persist the change.
    func renameTab(_ tab: WorkspaceTab, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        tab.customName = trimmed.isEmpty ? nil : trimmed
        tab.objectWillChange.send()
        objectWillChange.send()
        scheduleSnapshotSave()
    }

    // MARK: - Archive

    /// Archive a chat: record it (name, project, and — for a Claude chat — its
    /// session id and context size) in the Archived Chats list, then close it. The
    /// live terminal is freed exactly like a normal close; only the lightweight
    /// record survives, viewable and reopenable from the archive.
    func archiveTab(_ tab: WorkspaceTab) {
        let key = projectKey(for: tab)
        let index = projectGroups.first { $0.path == key }?
            .tabs.firstIndex { $0.id == tab.id } ?? 0
        let session = tab.sessions.first
        let agentId = tab.sessions.compactMap { $0.launchedAgentId }.first
        let record = ArchivedChat(
            projectPath: key,
            name: chatLabel(tab, index: index),
            wasClaude: agentId == "claude",
            agentId: agentId,
            sessionId: session?.agentSessionId,
            contextTokens: session?.contextTokens,
            contextLimit: session?.contextLimit,
            archivedAt: Date())
        settings.archivedChats.append(record)
        closeTab(tab)   // frees the terminal, fixes up selection, persists the rail
    }

    /// Archived chats grouped by their project, newest first within each group,
    /// for the Archived Chats list. Includes projects that currently have no live
    /// chats open — an archive can outlive its project's last open chat.
    var archivedByProject: [(path: String, name: String, chats: [ArchivedChat])] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return Dictionary(grouping: settings.archivedChats, by: { $0.projectPath })
            .map { path, chats in
                let display = (path == home || path.isEmpty || path == "/")
                    ? "Home" : (path as NSString).lastPathComponent
                return (path, display, chats.sorted { $0.archivedAt > $1.archivedAt })
            }
            .sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    /// Reopen an archived chat in its project — resuming its Claude conversation
    /// when a session id was captured — and drop it from the archive.
    @discardableResult
    func reopenArchived(_ chat: ArchivedChat) -> TerminalSession {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let path: String? = (chat.projectPath == home) ? nil : chat.projectPath
        let launch: String?
        if let agentId = chat.effectiveAgentId,
           let profile = AgentRegistry.profile(forId: agentId, settings: settings) {
            let id = (chat.sessionId?.isEmpty == false && profile.capabilities.resumable)
                ? chat.sessionId : nil
            launch = profile.launchCommand(resuming: id, settings: settings)
        } else {
            launch = nil
        }
        let session = newTab(projectPath: path,
                             launchOverride: launch,
                             suppressAutoLaunch: launch == nil)
        // Carry the name over, but only if it was a real custom name — never pin a
        // reopened chat to the positional "Chat N" it happened to show.
        if !chat.name.isEmpty && !chat.name.hasPrefix("Chat ") {
            tabs.last?.customName = chat.name
        }
        settings.archivedChats.removeAll { $0.id == chat.id }
        scheduleSnapshotSave()
        return session
    }

    /// Permanently drop an archived chat from the list.
    func deleteArchived(_ chat: ArchivedChat) {
        settings.archivedChats.removeAll { $0.id == chat.id }
    }

    // MARK: - Shared Project Note

    /// Where a project's shared note lives: a plain markdown file inside the
    /// project folder, so it's durable and every chat in the project can read it
    /// (the human via the rail, agents via `idealize note`).
    func projectNoteURL(_ path: String) -> URL? {
        guard !path.isEmpty, path != "/" else { return nil }
        return URL(fileURLWithPath: path)
            .appendingPathComponent(".idealize")
            .appendingPathComponent("project-note.md")
    }

    func projectNote(_ path: String) -> String {
        guard let url = projectNoteURL(path) else { return "" }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    func setProjectNote(_ path: String, _ text: String) {
        guard let url = projectNoteURL(path) else { return }
        let dir = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            try? FileManager.default.removeItem(at: url)
        } else {
            try? text.write(to: url, atomically: true, encoding: .utf8)
        }
        objectWillChange.send()
    }

    func projectHasNote(_ path: String) -> Bool {
        guard let url = projectNoteURL(path) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    /// The shared understanding an agent gets from `idealize note`: the human's
    /// brief, followed by a live line per chat in the project saying what it's
    /// working on (the agent's own note, or auto-derived from Claude's activity).
    func composedProjectNote(_ path: String) -> String {
        var out: [String] = []
        let brief = projectNote(path).trimmingCharacters(in: .whitespacesAndNewlines)
        if !brief.isEmpty { out.append(brief) }
        let tabs = projectGroups.first { $0.path == path }?.tabs ?? []
        let rows = tabs.enumerated().compactMap { index, tab -> String? in
            guard let s = tab.sessions.first else { return nil }
            return "- \(chatLabel(tab, index: index)): \(s.activityLine)"
        }
        if !rows.isEmpty {
            if !out.isEmpty { out.append("") }
            out.append("What each chat is working on:")
            out.append(contentsOf: rows)
        }
        return out.joined(separator: "\n")
    }

    // MARK: - Persistence (restore-on-launch)

    /// True while restoring so the per-tab saves from `newTab` don't clobber the
    /// snapshot mid-rebuild.
    private var isRestoring = false
    private var snapshotSaveWork: DispatchWorkItem?

    /// Rebuild the rail from the persisted snapshot. Reopens each project's
    /// folders and re-launches its chats (Claude for chats that were Claude,
    /// otherwise a bare shell). Call only when `tabs` is empty.
    func restoreProjects() {
        guard tabs.isEmpty else { return }
        let snapshot = settings.projectSnapshot
        guard !snapshot.isEmpty else { return }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        isRestoring = true
        for project in snapshot {
            // A Home chat has no real project folder; restore it with projectPath
            // nil (matching a freshly-created Home chat) rather than materialising
            // $HOME, which would otherwise let a shared note leak into ~/.idealize.
            let restorePath: String? = (project.path == home) ? nil : project.path
            for chat in project.chats {
                // Force the chat's recorded agent, so restore doesn't depend on
                // the current global auto-launch toggle / default command (which
                // could otherwise bring an agent chat back as a bare shell and
                // then re-persist it as agentId=nil — permanently losing it).
                // `launchCommand` respects the configured default when it
                // matches the same agent (extra flags survive).
                let launch: String? = chat.effectiveAgentId
                    .flatMap { AgentRegistry.profile(forId: $0, settings: settings) }
                    .map { $0.launchCommand(resuming: nil, settings: settings) }
                newTab(projectPath: restorePath,
                       launchOverride: launch,
                       suppressAutoLaunch: launch == nil)
                if let name = chat.customName, !name.isEmpty {
                    tabs.last?.customName = name   // newTab just inserted this tab
                }
            }
        }
        isRestoring = false
        saveProjectSnapshot()
    }

    /// Persist the current rail (debounced). No-op while restoring.
    func scheduleSnapshotSave() {
        guard !isRestoring else { return }
        snapshotSaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveProjectSnapshot() }
        snapshotSaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    /// Persist the rail immediately, cancelling any pending debounce. Called on
    /// app termination so a change made just before quit isn't lost to the 0.4s
    /// debounce window.
    func flushSnapshotSave() {
        snapshotSaveWork?.cancel()
        snapshotSaveWork = nil
        saveProjectSnapshot()
    }

    private func saveProjectSnapshot() {
        let snapshot: [PersistedProject] = projectGroups.map { group in
            let chats: [PersistedChat] = group.tabs
                // Don't persist the Service Hatch — it's launched by its own path.
                .filter { !($0.sessions.first?.isServiceHatch ?? false) }
                .map { tab in
                    let agentId = tab.sessions.compactMap { $0.launchedAgentId }.first
                    return PersistedChat(customName: tab.customName,
                                         wasClaude: agentId == "claude",
                                         agentId: agentId)
                }
            return PersistedProject(path: group.path, chats: chats)
        }
        // Drop projects that ended up with no persistable chats (e.g. a lone hatch).
        let live = snapshot.filter { !$0.chats.isEmpty }
        settings.projectSnapshot = live
        // Prune collapse state for projects that no longer have any chats, so the
        // set can't grow unbounded or leak a stale collapse onto a later reopen.
        let livePaths = Set(live.map { $0.path })
        let pruned = settings.collapsedProjects.filter { livePaths.contains($0) }
        if pruned.count != settings.collapsedProjects.count { settings.collapsedProjects = pruned }
    }

    // MARK: - IPC handling (called on main thread)

    private func handle(_ request: IPCRequest) -> IPCResponse {
        switch request.command {
        case .ping:
            return IPCResponse(ok: true, info: "pong")

        case .list:
            return IPCResponse(ok: true, sessions: allSessions.map { $0.sessionInfo })

        case .notify:
            let title = request.title ?? "IDEalize"
            let body = request.body ?? ""
            let fromLabel = request.from.flatMap { session(withID: $0)?.label }
            NotificationManager.shared.notify(
                title: fromLabel.map { "\(title) · \($0)" } ?? title,
                body: body,
                sound: request.sound ?? false)
            return IPCResponse(ok: true)

        case .send:
            guard let target = request.target else { return .failure("missing target") }
            guard let dest = resolveTarget(target) else { return .failure("no session matching '\(target)'") }
            let msg = IPCMessage(
                from: request.from ?? "?",
                fromLabel: request.from.flatMap { session(withID: $0)?.label },
                body: request.body ?? "",
                timestamp: Date())
            dest.deliver(msg)
            announceIncoming(to: dest, from: msg)
            return IPCResponse(ok: true, info: "delivered to \(dest.label) (\(dest.id))")

        case .broadcast:
            let sender = request.from
            let recipients = allSessions.filter { $0.id != sender }
            for dest in recipients {
                let msg = IPCMessage(
                    from: sender ?? "?",
                    fromLabel: sender.flatMap { session(withID: $0)?.label },
                    body: request.body ?? "",
                    timestamp: Date())
                dest.deliver(msg)
                announceIncoming(to: dest, from: msg)
            }
            return IPCResponse(ok: true, info: "broadcast to \(recipients.count) session(s)")

        case .inbox:
            guard let from = request.from, let s = session(withID: from) else {
                return .failure("unknown sender session")
            }
            return IPCResponse(ok: true, messages: s.drainMailbox())

        case .peek:
            guard let from = request.from, let s = session(withID: from) else {
                return .failure("unknown sender session")
            }
            return IPCResponse(ok: true, messages: s.peekMailbox())

        case .setStatus:
            guard let from = request.from, let s = session(withID: from) else {
                return .failure("unknown sender session")
            }
            s.customStatus = request.body
            return IPCResponse(ok: true)

        case .note:
            guard let from = request.from, let s = session(withID: from) else {
                return .failure("unknown sender session")
            }
            guard let path = s.projectPath, !path.isEmpty, path != "/" else {
                return .failure("this terminal isn't in a project folder")
            }
            if request.target == "mine" {         // --mine: set this chat's own line
                let text = (request.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                s.agentNote = text.isEmpty ? nil : text
                objectWillChange.send()
                return IPCResponse(ok: true, info: text.isEmpty ? "your note cleared" : "noted")
            }
            if let body = request.body {          // --set: write the brief (empty clears)
                setProjectNote(path, body)
                return IPCResponse(ok: true, info: "note updated")
            }
            return IPCResponse(ok: true, info: composedProjectNote(path))   // get

        case .focus:
            guard let target = request.target, let s = resolveTarget(target) else {
                return .failure("no session matching target")
            }
            focusSession(s.id)
            return IPCResponse(ok: true)

        case .input:
            guard let target = request.target, let s = resolveTarget(target) else {
                return .failure("no session matching target")
            }
            s.insert(request.body ?? "")
            return IPCResponse(ok: true, info: "sent to \(s.label)")

        case .reveal:
            guard let path = request.target, !path.isEmpty else { return .failure("missing path") }
            return reveal(path: path, open: request.open ?? false)

        case .agentHello:
            // An unknown agent answering the first-run introduction — hand the
            // descriptor to its session, which verifies (nonce, path bounds)
            // and caches it. The IPC path beats the printed-sentinel fallback.
            guard let from = request.from, let s = session(withID: from) else {
                return .failure("unknown sender session")
            }
            guard let body = request.body, !body.isEmpty else {
                return .failure("missing hello payload")
            }
            if let problem = s.receiveAgentHello(json: body) {
                return .failure(problem)
            }
            return IPCResponse(ok: true, info: "hello received — IDEalize can read this agent now")

        case .blocks:
            let target = request.target ?? request.from
            guard let t = target, let s = resolveTarget(t) ?? session(withID: t) else {
                return .failure("unknown session")
            }
            let blocks = s.blocks.suffix(50).map { b in
                IPCBlock(command: b.command,
                         cwd: b.cwd,
                         exitCode: b.exitCode,
                         running: b.isRunning,
                         durationMs: b.duration.map { Int($0 * 1000) })
            }
            return IPCResponse(ok: true, blocks: Array(blocks))
        }
    }

    /// Resolve a target string to a session by id, then by tab/label, then by
    /// project directory name.
    private func resolveTarget(_ target: String) -> TerminalSession? {
        if let exact = session(withID: target) { return exact }
        let lower = target.lowercased()
        if let byLabel = allSessions.first(where: { $0.label.lowercased() == lower }) { return byLabel }
        return allSessions.first { s in
            guard let p = s.projectPath else { return false }
            return (p as NSString).lastPathComponent.lowercased() == lower
        }
    }

    private func announceIncoming(to dest: TerminalSession, from msg: IPCMessage) {
        dest.hasActivity = true
        if settings.notificationsEnabled {
            NotificationManager.shared.notify(
                title: "Message → \(dest.label)",
                body: "\(msg.fromLabel ?? msg.from): \(msg.body)",
                sound: false)
        }
    }
}

private extension PaneNode {
    func onCopyFocus(from other: PaneNode) {}
}
