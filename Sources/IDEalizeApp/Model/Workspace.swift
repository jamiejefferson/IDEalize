import SwiftUI
import AppKit
import IDEalizeCore

/// A simple message-carrying error used when a session target can't be resolved.
struct TargetResolutionError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

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
    /// Whether the Keyboard Shortcuts reference sheet is on screen
    /// (Help ▸ Keyboard Shortcuts, ⌘/).
    @Published var showShortcutsHelp: Bool = false
    /// Bumped by the Focus Message Input command (⌘I); the focused pane's chat
    /// input observes it and takes the caret.
    @Published var focusInputRequest: Int = 0
    /// The chat the user just opened, whose message input should take the caret
    /// so the chat is ready to type into without a click — and the moment that
    /// claim lapses.
    ///
    /// Deliberately *not* spent by the first input that appears. A brand-new
    /// chat builds its composer, then rebuilds it a beat later as the pane
    /// settles onto its resting view, which tears the first composer down and
    /// takes the caret with it. A one-shot claim is always spent by that first,
    /// doomed composer and the chat lands unfocused. So the claim stays live for
    /// a short window instead, and *every* composer that appears for that chat
    /// takes the caret — leaving it in the one that survives.
    private var inputFocusClaim: (sessionID: String, until: Date)?
    /// How long a new chat's claim on the caret stays live. Comfortably longer
    /// than the pane's settle-and-rebuild (measured at ~0.6s) without lingering
    /// so long that it could pull the caret back after the user has moved on.
    private static let inputFocusClaimWindow: TimeInterval = 2.5
    /// Which section (tab) of the Appearance panel is showing. Starts on the
    /// theme, which is the base everything else layers over.
    @Published var appearanceSection: AppearanceSection = .theme
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
        // The name becomes a single path component — reject anything that could
        // climb out of the project directory.
        guard name != "..", !name.contains("/"), !name.contains("\\") else { return nil }
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
        // Resolve symlinks before any prefix check: `standardizedFileURL` does
        // NOT resolve them, so a symlink inside a project could otherwise point
        // the reveal (and its authorization) outside the project.
        let url = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .failure("no such file: \(url.path)")
        }
        guard let owner = sessionOwning(url) else {
            return .failure("\(url.path) isn't inside any folder open in IDEalize")
        }
        // A session without a project directory owns nothing — the old
        // whole-home fallback made anything under ~ revealable.
        guard let explorerRoot = owner.explorerRoot else {
            return .failure("no project directory for this session")
        }
        // The tree never lists dotfiles, so it can't scroll to one. Only the part
        // of the path *below* the root matters — the root itself is free to live
        // somewhere hidden, like ~/.config/something.
        let root = URL(fileURLWithPath: explorerRoot).standardizedFileURL.resolvingSymlinksInPath().path
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
    /// the user off to the other one. Both sides are symlink-resolved so a link
    /// inside a project can't escape the prefix check.
    private func sessionOwning(_ url: URL) -> TerminalSession? {
        func contains(_ session: TerminalSession) -> Bool {
            // Sessions without a project directory own nothing (no home fallback).
            guard let explorerRoot = session.explorerRoot else { return false }
            let root = URL(fileURLWithPath: explorerRoot).standardizedFileURL.resolvingSymlinksInPath().path
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

    /// Per-instance capability token authorizing mutating IPC commands. Generated
    /// at startup, injected into every spawned shell as `IDEALIZE_TOKEN`, and
    /// mirrored to `IPC.tokenFilePath` (0600) so a CLI running outside an
    /// IDEalize-spawned shell (e.g. via a symlink) can still authenticate.
    let ipcToken: String = Workspace.generateToken()

    private static func generateToken() -> String {
        // UUID + 16 random hex bytes; Swift's RNG is a CSPRNG on Darwin.
        let hex = (0..<16).map { _ in String(format: "%02x", UInt8.random(in: .min ... .max)) }.joined()
        return UUID().uuidString.lowercased() + "-" + hex
    }

    /// Single shared registry so terminals across all tabs/panes (and projects)
    /// can address one another over IPC.
    static let shared = Workspace()

    init(settings: AppSettings = .shared) {
        self.settings = settings
    }

    /// Start the IPC hub once (first window). Safe to call repeatedly.
    func startIPCIfNeeded() {
        guard ipcHub == nil else { return }
        writeTokenFile()
        let hub = IPCHub { [weak self] request in
            guard let self else { return .failure("workspace gone") }
            // `verify` may run a full build; keep it OFF the main thread so it can
            // never freeze the UI. Everything else touches the model, so it hops
            // to main.
            if request.command == .verify { return self.handleVerify(request) }
            var response = IPCResponse.failure("workspace gone")
            let work = { response = self.handle(request) }
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

    /// Mirror the capability token to disk, owner-only, so `idealize` works when
    /// invoked without the app's environment (see `IPC.tokenFilePath`).
    private func writeTokenFile() {
        let path = IPC.tokenFilePath
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        FileManager.default.createFile(
            atPath: path, contents: Data(ipcToken.utf8),
            attributes: [.posixPermissions: 0o600])
        // Tighten even if the file already existed with looser perms.
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
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
                openingTurn: String? = nil,
                suppressAutoLaunch: Bool = false,
                safeCopy: TerminalSession.SafeCopy? = nil) -> TerminalSession {
        if let projectPath { settings.addRecentFolder(projectPath) }
        let session = makeSession(projectPath: projectPath,
                                  launchOverride: launchOverride,
                                  openingTurn: openingTurn,
                                  suppressAutoLaunch: suppressAutoLaunch,
                                  safeCopy: safeCopy)
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
        // Restore reopens many tabs through this same path; only a chat the user
        // actually asked for gets the caret.
        if !isRestoring { claimInputFocus(for: session.id) }
        bindName(tab, to: session)
        scheduleSnapshotSave()
        considerProjectAgent(for: session, launchOverride: launchOverride)
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
        panel.message = "Choose a folder for the new terminal — or use “New Folder” below to create one"
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
                             openingTurn: String? = nil,
                             suppressAutoLaunch: Bool = false,
                             safeCopy: TerminalSession.SafeCopy? = nil) -> TerminalSession {
        let session = TerminalSession(settings: settings, workspace: self, projectPath: projectPath)
        session.launchOverride = launchOverride
        session.launchPositional = openingTurn
        session.suppressAutoLaunch = suppressAutoLaunch
        // Set the safe copy *before* start(): the shell's working directory is
        // derived from it, so it has to be in place when the process launches.
        session.safeCopy = safeCopy
        session.onFocusRequested = { [weak self] sid in self?.focusSession(sid) }
        session.onUserFocused = { [weak self] sid in self?.setFocusedFromUserInteraction(sid) }
        session.start()
        return session
    }

    /// Open a "service hatch": a new tab rooted in IDEalize's own source, dropping
    /// straight into an agent dev session (permissions skipped, vault docs in scope)
    /// preloaded with the `/idealize-service-hatch` safe-editing guide. Beeps if the
    /// source checkout can't be located.
    func openServiceHatch() {
        guard let repo = ServiceHatch.repoRoot() else {
            // No source checkout configured or found. An installed app can't guess
            // where IDEalize's code lives, so open Settings for the user to point
            // at it (Launch tab → "IDEalize source folder") rather than beep.
            SettingsWindow.open()
            return
        }
        let hatch = ServiceHatch.launch()
        let session = newTab(projectPath: repo,
                             launchOverride: hatch.command,
                             openingTurn: hatch.openingTurn)
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

    // MARK: - Project agent

    /// Watches over each coordinated project, keyed by project path. Started
    /// with the project agent's chat, stopped when it closes.
    private var projectMonitors: [String: ProjectMonitor] = [:]

    /// Projects whose "start a project agent?" suggestion the user has
    /// dismissed. In-memory only — the suggestion may be worth seeing again
    /// next run.
    @Published var dismissedProjectAgentSuggestions: Set<String> = []

    /// The project a "start a project agent?" prompt is currently offered for,
    /// if any. Set when a project first gains a second chat; drives the modal in
    /// `WorkspaceView`. Carries the project path so the modal targets the right
    /// project no matter what's focused when the user answers.
    @Published var pendingProjectAgentPrompt: ProjectAgentPrompt?

    /// The project agent chat for `path`, if one is running.
    func projectAgentSession(forProject path: String) -> TerminalSession? {
        allSessions.first { $0.isProjectAgent && $0.projectPath == path }
    }

    /// The project agent for the *focused* session's project — what the
    /// toolbar toggle acts on.
    var focusedProjectAgent: TerminalSession? {
        guard let p = focusedSession?.projectPath else { return nil }
        return projectAgentSession(forProject: p)
    }

    /// Whether the focused session's project has a live project agent.
    var isProjectAgentOpen: Bool { focusedProjectAgent != nil }

    /// Whether the focused project can have a project agent (a real folder,
    /// not home or root) — drives the toolbar toggle's enabled state.
    var canOpenProjectAgent: Bool {
        ProjectAgent.isCoordinatable(focusedSession?.projectPath)
    }

    /// Decide about a project agent for the *focused* session's project when it's
    /// just grown to two or more chats, none coordinating yet, and the user hasn't
    /// dismissed the suggestion for it: start one outright when the user has said
    /// they always want that, otherwise offer it as a one-time modal (see
    /// `pendingProjectAgentPrompt`) rather than a standing banner. Called as a
    /// real chat is added; no-op during restore or for the hatch/agent's own
    /// launches (those pass a `launchOverride`).
    ///
    /// This guard is the single home of the "two or more chats" rule — it was once
    /// spelled out in three places and the copies drifted apart. Anything else that
    /// wants to know whether a project is ready for an agent must come through here.
    private func considerProjectAgent(for session: TerminalSession, launchOverride: String?) {
        guard !isRestoring, launchOverride == nil,
              let project = session.projectPath,
              ProjectAgent.isCoordinatable(project),
              !dismissedProjectAgentSuggestions.contains(project),
              projectAgentSession(forProject: project) == nil,
              allSessions.filter({ $0.projectPath == project && !$0.isProjectAgent }).count >= 2
        else { return }
        guard settings.projectAgentAutoStart else {
            pendingProjectAgentPrompt = ProjectAgentPrompt(path: project)
            return
        }
        // The agent works in the background: the user asked for a chat, so
        // that's where their focus (and next keystrokes) should land.
        openProjectAgent(forProject: project, focus: false)
    }

    /// Open a project agent for the focused session's project. Beeps when
    /// there's no real project folder to coordinate.
    func openProjectAgent() {
        guard let project = focusedSession?.projectPath else { NSSound.beep(); return }
        openProjectAgent(forProject: project)
    }

    /// Open a project agent for `project`: a regular agent chat preloaded with
    /// the `/project-agent` coordinating guide, named so it's instantly
    /// distinguishable from the chats it watches. Enforces one agent per
    /// project — if one is already running it's simply focused, never
    /// duplicated. Beeps when the path isn't a real project folder.
    ///
    /// Pass `focus: false` to launch the agent in the background: every new tab
    /// takes selection with it, so without putting focus back the user (and
    /// their next keystrokes) would land in the agent instead of the chat they
    /// were in. The agent still appears in the rail.
    func openProjectAgent(forProject project: String, focus: Bool = true) {
        guard ProjectAgent.isCoordinatable(project) else { NSSound.beep(); return }
        if let existing = projectAgentSession(forProject: project) {
            if focus { focusSession(existing.id) }   // already running — just show it
            return
        }
        let originTab = selectedTabID
        let originFocus = focusedSessionID
        let agent = ProjectAgent.launch()
        let session = newTab(projectPath: project,
                             launchOverride: agent.command,
                             openingTurn: agent.openingTurn)
        session.isProjectAgent = true
        if !focus {
            selectedTabID = originTab
            focusedSessionID = originFocus
        }
        if let tab = tabs.first(where: { t in t.sessions.contains { $0.id == session.id } }) {
            tab.customName = "Project agent"
        }
        projectMonitors[project] = ProjectMonitor(
            projectPath: project, coordinator: session, workspace: self)
        considerLeadAgent()
    }

    /// Toggle the project agent for the focused session's project, like the
    /// service-hatch toggle: open one if none is running, otherwise close it.
    func toggleProjectAgent() {
        if let agent = focusedProjectAgent {
            closeSession(agent)
        } else {
            openProjectAgent()
        }
    }

    /// Stop watching a project whose agent chat just closed — and the fleet,
    /// when the closing chat is the lead.
    private func stopProjectMonitor(for session: TerminalSession) {
        if session.isLeadAgent {
            fleetMonitor?.stop()
            fleetMonitor = nil
        }
        guard session.isProjectAgent, let p = session.projectPath else { return }
        projectMonitors[p]?.stop()
        projectMonitors[p] = nil
    }

    // MARK: - Lead agent

    /// The workspace's lead agent chat, if one is running. At most one exists.
    var leadAgentSession: TerminalSession? {
        allSessions.first { $0.isLeadAgent }
    }

    /// Deterministic fleet-level signals for the lead (and stale-inbox nudges
    /// for the coordination tier), alive exactly while the lead's chat is.
    private var fleetMonitor: FleetMonitor?

    /// Whether the "start a lead agent?" offer is up. `true` is set by
    /// `considerLeadAgent()`; the sheet in `WorkspaceView` answers it.
    @Published var pendingLeadAgentPrompt = false

    /// "Not now" settles the offer for the run of the app — same lifetime as
    /// `dismissedProjectAgentSuggestions`.
    private var dismissedLeadAgentSuggestion = false

    /// Offer (or auto-start) the lead agent once the fleet is big enough to
    /// need one: two or more distinct projects each running a project agent,
    /// no lead yet, and the user hasn't said "not now" this run. Called as a
    /// project agent opens; the single home of this rule, like
    /// `considerProjectAgent` is for the two-chat rule.
    private func considerLeadAgent() {
        guard !isRestoring,
              leadAgentSession == nil,
              !dismissedLeadAgentSuggestion,
              !pendingLeadAgentPrompt else { return }
        let coordinated = Set(allSessions.filter(\.isProjectAgent).compactMap(\.projectPath))
        guard coordinated.count >= 2 else { return }
        if settings.leadAgentAutoStart {
            openLeadAgent(focus: false)
        } else {
            pendingLeadAgentPrompt = true
        }
    }

    /// "Not now" on the lead-agent offer.
    func dismissLeadAgentSuggestion() {
        dismissedLeadAgentSuggestion = true
        pendingLeadAgentPrompt = false
    }

    var isLeadAgentOpen: Bool { leadAgentSession != nil }

    /// Open the lead agent: a regular agent chat preloaded with the
    /// `/lead-agent` guide, living in its own "Fleet" folder so the rail shows
    /// it as its own group above no particular project. One per workspace — if
    /// it's already running it's focused, never duplicated.
    ///
    /// Pass `focus: false` to launch it in the background (same contract as
    /// `openProjectAgent(forProject:focus:)`).
    func openLeadAgent(focus: Bool = true) {
        if let existing = leadAgentSession {
            if focus { focusSession(existing.id) }   // already running — just show it
            return
        }
        LeadAgent.ensureFleetHome()
        let originTab = selectedTabID
        let originFocus = focusedSessionID
        let launch = LeadAgent.launch()
        let session = newTab(projectPath: LeadAgent.fleetHomeURL.path,
                             launchOverride: launch.command,
                             openingTurn: launch.openingTurn)
        session.isLeadAgent = true
        if !focus {
            selectedTabID = originTab
            focusedSessionID = originFocus
        }
        if let tab = tabs.first(where: { t in t.sessions.contains { $0.id == session.id } }) {
            tab.customName = "Lead agent"
        }
        fleetMonitor = FleetMonitor(lead: session, workspace: self)
    }

    /// Toggle the lead agent, like the project-agent toggle: open it if none
    /// is running, otherwise close it.
    func toggleLeadAgent() {
        if let lead = leadAgentSession {
            closeSession(lead)
        } else {
            openLeadAgent()
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
        stopProjectMonitor(for: session)
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
        tab.sessions.forEach { stopProjectMonitor(for: $0); $0.terminate() }
        tabs.removeAll { $0.id == tab.id }
        if selectedTabID == tab.id { selectedTabID = tabs.last?.id }
        if let next = selectedTab?.sessions.first { focusedSessionID = next.id }
        scheduleSnapshotSave()
    }

    func sessionDidTerminate(_ session: TerminalSession) {
        // If a shell exits on its own, clean up its pane.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.stopProjectMonitor(for: session)
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
        // The user has put their attention somewhere else — a new chat's claim
        // on the caret must not pull it back out from under them.
        inputFocusClaim = nil
        focusedSessionID = id
        session(withID: id)?.markRead()
    }

    /// Claim the caret for a chat's message input for the next moment. See
    /// `inputFocusClaim` for why the claim outlives the first composer.
    func claimInputFocus(for id: String?) {
        guard let id else { return }
        inputFocusClaim = (id, Date().addingTimeInterval(Self.inputFocusClaimWindow))
    }

    /// Whether this chat's message input should take the caret as it appears.
    /// Non-consuming: the claim lapses on its own deadline.
    func wantsInputFocus(_ id: String) -> Bool {
        guard let claim = inputFocusClaim else { return false }
        return claim.sessionID == id && Date() < claim.until
    }

    /// Put the caret back in the focused chat's composer after a sheet that took
    /// the keyboard closes over it. A modal sheet holds the keyboard while it is
    /// up, so a new chat opened underneath one can't be typed into until the
    /// sheet goes — this hands the caret over the moment it does. Deferred past
    /// the sheet's dismissal so the field isn't asked to focus behind it.
    func refocusInputAfterSheet() {
        claimInputFocus(for: focusedSessionID)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.focusInputRequest += 1
        }
    }

    func focusSession(_ id: String) {
        guard let tab = tabs.first(where: { t in t.sessions.contains { $0.id == id } }) else { return }
        // Focus is being sent somewhere deliberately (the terminal takes the
        // keyboard below); a different chat's claim on the caret is now stale.
        if id != inputFocusClaim?.sessionID { inputFocusClaim = nil }
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
        let theme = settings.terminalTheme
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

        /// The project's coordinating agent tab, if one is running. Shown
        /// attached to the project container rather than among the chats.
        var agentTab: WorkspaceTab? {
            tabs.first { $0.sessions.first?.isProjectAgent == true }
        }

        /// The ordinary chats in this project — everything but the agent.
        var chatTabs: [WorkspaceTab] {
            tabs.filter { $0.sessions.first?.isProjectAgent != true }
        }
    }

    /// Identifies the project a "start a project agent?" prompt is offered for,
    /// so the modal can act on that project regardless of what's focused when
    /// the user answers.
    struct ProjectAgentPrompt: Identifiable {
        let path: String
        var id: String { path }
        var displayName: String {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            if path == home || path.isEmpty || path == "/" { return "Home" }
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

    /// The lead agent's tab, if one is running. The rail draws it as its own
    /// card pinned above the project list — the lead visually leads the fleet
    /// rather than sitting inside a "Fleet" folder card.
    var leadAgentTab: WorkspaceTab? {
        tabs.first { $0.sessions.first?.isLeadAgent == true }
    }

    /// The groups the rail shows: `projectGroups` minus the lead agent's tab.
    /// A group left empty by its removal (the lead's Fleet home) disappears
    /// entirely. Persistence keeps using `projectGroups`, so the lead still
    /// snapshots and restores.
    var railGroups: [ProjectGroup] {
        projectGroups.compactMap { group in
            var g = group
            g.tabs.removeAll { $0.sessions.first?.isLeadAgent == true }
            return g.tabs.isEmpty ? nil : g
        }
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
        let binary = tab.sessions.compactMap(\.agentBinary).first
        let record = ArchivedChat(
            projectPath: key,
            name: chatLabel(tab, index: index),
            wasClaude: binary == "claude",
            agentBinary: binary,
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

    /// Reopen an archived chat in its project — resuming its agent's
    /// conversation when a session id was captured — and drop it from the archive.
    @discardableResult
    func reopenArchived(_ chat: ArchivedChat) -> TerminalSession {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let path: String? = (chat.projectPath == home) ? nil : chat.projectPath
        let launch: String? = {
            guard let adapter = AgentRegistry.adapter(forBinary: chat.effectiveAgentBinary)
            else { return nil }
            if let id = chat.sessionId, !id.isEmpty,
               let resume = adapter.resumeCommand(sessionId: id) {
                return resume
            }
            return adapter.launchCommand
        }()
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
    /// otherwise a bare shell), and brings a project's coordinating chat back as
    /// a coordinator. Call only when `tabs` is empty.
    func restoreProjects() {
        guard tabs.isEmpty else { return }
        let snapshot = settings.projectSnapshot
        guard !snapshot.isEmpty else { return }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        // Force the chat's own agent on restore, so it doesn't depend on the
        // current global auto-launch toggle / default command (which could
        // otherwise bring an agent chat back as a bare shell and then re-persist
        // it as a shell — permanently losing its agent-ness). The user's default
        // command wins when it invokes the same agent (it may carry their flags).
        let defaultCommand = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        func agentLaunch(_ binary: String?) -> String? {
            guard let adapter = AgentRegistry.adapter(forBinary: binary) else { return nil }
            if adapter.matches(command: defaultCommand.lowercased()) { return defaultCommand }
            return adapter.launchCommand
        }
        isRestoring = true
        for project in snapshot {
            // A Home chat has no real project folder; restore it with projectPath
            // nil (matching a freshly-created Home chat) rather than materialising
            // $HOME, which would otherwise let a shared note leak into ~/.idealize.
            let restorePath: String? = (project.path == home) ? nil : project.path
            for chat in project.chats {
                // A coordinating chat comes back *as* one: relaunched with the
                // coordinating guide, so the project is watched again instead of
                // returning as an ordinary chat that leaves the work uncoordinated
                // (and lets the rail offer to start a second coordinator).
                //
                // Chats saved before the flag existed decode as false, so a
                // coordinator from an older run comes back as a plain chat — once,
                // after which it persists as what it now is. We deliberately never
                // infer coordinator-ness from the chat's *name*: a chat the user
                // happened to call "Project agent" would silently start watching
                // their files.
                let restored: AgentLaunch?
                if chat.isLeadAgent {
                    // The lead comes back *as* the lead: relaunched with its
                    // guide, in the Fleet folder the snapshot recorded.
                    LeadAgent.ensureFleetHome()
                    restored = LeadAgent.launch()
                } else if chat.isProjectAgent {
                    restored = ProjectAgent.launch()
                } else {
                    restored = agentLaunch(chat.effectiveAgentBinary).map { AgentLaunch(command: $0) }
                }
                let session = newTab(
                    projectPath: restorePath,
                    launchOverride: restored?.command,
                    openingTurn: restored?.openingTurn,
                    suppressAutoLaunch: restored == nil)
                // The piece's check survives restart (its definition of done);
                // the safe copy doesn't, so the check runs in the shared folder.
                session.verifyCommand = chat.verifyCommand
                if let name = chat.customName, !name.isEmpty {
                    tabs.last?.customName = name   // newTab just inserted this tab
                } else if chat.isLeadAgent {
                    tabs.last?.customName = "Lead agent"
                } else if chat.isProjectAgent {
                    // A coordinator is named as it's opened, so it normally arrives
                    // here already named — and if the user renamed it, that name is
                    // what we just restored above. This only covers a coordinator
                    // that somehow saved without a name, so it stays recognisable.
                    tabs.last?.customName = "Project agent"
                }
                if chat.isLeadAgent {
                    session.isLeadAgent = true
                }
                if chat.isProjectAgent {
                    session.isProjectAgent = true
                    // Watch the project again exactly as opening a coordinator
                    // does — but only for a real project folder: Home (restored as
                    // a nil path) has nothing coherent to coordinate.
                    if let project = restorePath, ProjectAgent.isCoordinatable(project) {
                        projectMonitors[project] = ProjectMonitor(
                            projectPath: project, coordinator: session, workspace: self)
                    }
                }
            }
        }
        isRestoring = false
        // A restored lead watches the fleet again exactly as opening one does.
        if let lead = leadAgentSession {
            fleetMonitor = FleetMonitor(lead: lead, workspace: self)
        }
        // The restored fleet may already merit a lead (two coordinated projects
        // came back and the user auto-starts) — decide now that restore is done.
        considerLeadAgent()
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
                // Don't persist the Service Hatch — it's opened on demand from the
                // toolbar and belongs to whichever source folder is configured at
                // the time. The project agent *is* persisted, flagged as one, so
                // restore can bring it back still coordinating; leaving it out is
                // what used to make a project come back unwatched and then offer to
                // start a second agent.
                .filter { !($0.sessions.first?.isServiceHatch ?? false) }
                .map { tab in
                    let binary = tab.sessions.compactMap(\.agentBinary).first
                    return PersistedChat(customName: tab.customName,
                                         wasClaude: binary == "claude",
                                         agentBinary: binary,
                                         isProjectAgent: tab.sessions.first?.isProjectAgent ?? false,
                                         isLeadAgent: tab.sessions.first?.isLeadAgent ?? false,
                                         verifyCommand: tab.sessions.first?.verifyCommand)
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
        // Unauthenticated peers may only probe (ping/list). Everything else can
        // read mailboxes or inject keystrokes into terminals, so it requires the
        // per-instance capability token.
        switch request.command {
        case .ping, .list:
            break
        default:
            guard isAuthorized(request) else {
                return .failure("unauthorized: missing or invalid IDEALIZE_TOKEN")
            }
        }
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
            let dest: TerminalSession
            switch resolveTarget(target, from: request.from) {
            case .success(let s): dest = s
            case .failure(let error): return .failure(error.message)
            }
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
            // The lead agent may *read* another project's shared note with an
            // explicit `--path` (never write it — the note belongs to the
            // project's own chats and user).
            if let explicit = request.target, explicit != "mine", !explicit.isEmpty,
               s.isLeadAgent {
                guard request.body == nil else {
                    return .failure("the lead agent reads a project's note; it doesn't write it")
                }
                return IPCResponse(ok: true, info: composedProjectNote(explicit))
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
            guard let target = request.target else {
                return .failure("no session matching target")
            }
            switch resolveTarget(target, from: request.from) {
            case .success(let s):
                focusSession(s.id)
                return IPCResponse(ok: true)
            case .failure(let error):
                return .failure(error.message)
            }

        case .input:
            guard let target = request.target else {
                return .failure("no session matching target")
            }
            let s: TerminalSession
            switch resolveTarget(target, from: request.from) {
            case .success(let found): s = found
            case .failure(let error): return .failure(error.message)
            }
            let body = request.body ?? ""
            guard !body.isEmpty else { return .failure("missing text") }
            // The session decides how to land it: an agent chat needs the message
            // *submitted* (a discrete Return after a beat), not merely typed. It
            // refuses while the target is mid-confirmation, so a steering message
            // can't accidentally answer a yes/no prompt.
            guard s.deliverExternalInput(body) else {
                return .failure("\(s.label) is waiting on a yes/no answer of its own — "
                                + "leave it a moment and send this again")
            }
            return IPCResponse(ok: true, info: "sent to \(s.label)")

        case .reveal:
            guard let path = request.target, !path.isEmpty else { return .failure("missing path") }
            return reveal(path: path, open: request.open ?? false)

        case .blocks:
            let target = request.target ?? request.from
            guard let t = target else { return .failure("unknown session") }
            let s: TerminalSession
            switch resolveTarget(t, from: request.from) {
            case .success(let found): s = found
            case .failure(let error): return .failure(error.message)
            }
            let blocks = s.blocks.suffix(50).map { b in
                IPCBlock(command: b.command,
                         cwd: b.cwd,
                         exitCode: b.exitCode,
                         running: b.isRunning,
                         durationMs: b.duration.map { Int($0 * 1000) })
            }
            return IPCResponse(ok: true, blocks: Array(blocks))

        case .transcript:
            // Read another chat's recent Q&A — the project agent's eyes into
            // what each chat has been doing and deciding.
            let target = request.target ?? request.from
            guard let t = target else { return .failure("unknown session") }
            let s: TerminalSession
            switch resolveTarget(t, from: request.from) {
            case .success(let found): s = found
            case .failure(let error): return .failure(error.message)
            }
            let limit = max(1, min(request.limit ?? 10, 50))
            let exchanges = s.exchanges.suffix(limit).map { e in
                // Cap each answer so a huge reply can't bloat the wire.
                let answer = e.answer.map { $0.count > 4000 ? String($0.prefix(4000)) + "…" : $0 }
                return IPCExchange(index: e.index, question: e.question, answer: answer)
            }
            return IPCResponse(ok: true, exchanges: exchanges)

        case .agentHello:
            // An unknown agent answering the first-run introduction — hand the
            // descriptor to its session, which verifies it (nonce, $HOME-bound
            // transcript path) and saves it as a custom agent profile. The
            // automatic counterpart of the manual AgentSetupSheet.
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

        case .spawn:
            // The project agent (or any authorized chat) starts a new worker chat
            // and, optionally, hands it an opening task. The new chat is a normal
            // member of the project — the user can open and review it like any
            // other — so this is how one coordinating agent delegates work while
            // the user keeps talking to just that agent.
            let project: String
            if let t = request.target, !t.isEmpty {
                project = t                                   // explicit --path
            } else if let from = request.from,
                      let p = session(withID: from)?.projectPath {
                project = p                                   // default: caller's project
            } else {
                return .failure("no project folder to spawn in — pass a path")
            }
            guard ProjectAgent.isCoordinatable(project) else {
                return .failure("'\(project)' isn't a real project folder to spawn a chat in")
            }
            // With `--coordinator`, start (or surface) the project's *coordinating
            // agent* instead of a worker — how the lead agent bootstraps a project
            // agent for an unwatched project, or relaunches one that died. One per
            // project is enforced by `openProjectAgent`, so this is idempotent.
            if request.coordinator == true {
                openProjectAgent(forProject: project, focus: false)
                guard let agent = projectAgentSession(forProject: project) else {
                    return .failure("couldn't start a project agent for '\(project)'")
                }
                if let from = request.from, session(withID: from) != nil {
                    focusSession(from)
                }
                return IPCResponse(ok: true, info: agent.id)
            }
            // With `--isolated`, give the child its own safe copy (a separate
            // worktree) so it can't collide with other chats. If the folder can't
            // support one (not a git repo, no commits), fall back to the shared
            // folder — spawning still succeeds, additive and non-fatal.
            var safeCopy: TerminalSession.SafeCopy? = nil
            if request.isolated == true,
               let copy = WorktreeService.create(from: project, label: request.body) {
                safeCopy = TerminalSession.SafeCopy(worktreePath: copy.path,
                                                    branch: copy.branch,
                                                    baseCommit: copy.base)
            }
            let launch = ProjectAgent.childLaunch(initialPrompt: request.body,
                                                  model: request.model)
            let child = newTab(projectPath: project, launchOverride: launch.command,
                               openingTurn: launch.openingTurn, safeCopy: safeCopy)
            // Remember the check that proves this piece done (`--verify "CMD"`),
            // so `idealize verify <id>` later runs it. Stored verbatim; empty
            // means "not attached". The app never invents a check itself.
            if let check = request.check?.trimmingCharacters(in: .whitespacesAndNewlines),
               !check.isEmpty {
                child.verifyCommand = check
                scheduleSnapshotSave()
            }
            // Name the tab after the piece of work, so the sidebar reads as the
            // project's actual jobs rather than "Chat 3", "Chat 4". The caller's own
            // label wins — it knows what the piece *is*, which the opening words of
            // a full brief often don't say — and we read one off the task when it
            // didn't supply one. Both go through `chatName` so a caller can't put an
            // essay in the sidebar.
            if let label = request.name.flatMap(ProjectAgent.chatName(fromTask:))
                ?? request.body.flatMap(ProjectAgent.chatName(fromTask:)),
               let tab = tabs.first(where: { t in t.sessions.contains { $0.id == child.id } }) {
                tab.customName = label
            }
            // Don't steal the user's place: spawning opens the child in the
            // background and returns focus to the caller (the coordinator chat),
            // so the user keeps talking to the one agent. `newTab` moved focus to
            // the child; put it back.
            if let from = request.from, session(withID: from) != nil {
                focusSession(from)
            }
            // Echo whether isolation actually happened, so a caller that asked for
            // it can tell when the folder couldn't support a separate copy.
            return IPCResponse(ok: true, info: child.id,
                               isolated: request.isolated == true ? (safeCopy != nil) : nil)

        case .gitDiff:
            // Read-only: what a chat has changed. Isolated chats compare against
            // their safe copy's base; shared-tree chats against the given ref
            // (default origin/main). `--target REF` arrives in `body`.
            let t = request.target ?? request.from
            guard let t else { return .failure("unknown chat") }
            let s: TerminalSession
            switch resolveTarget(t, from: request.from) {
            case .success(let found): s = found
            case .failure(let error): return .failure(error.message)
            }
            guard let dir = s.workingDirectory, !dir.isEmpty else {
                return .failure("this chat has no folder to look at")
            }
            let base = (request.body?.isEmpty == false) ? request.body!
                     : (s.safeCopy?.baseCommit ?? "origin/main")
            guard let diff = WorktreeService.diff(worktree: dir, base: base) else {
                return .failure("this chat's folder isn't set up to track changes")
            }
            return IPCResponse(ok: true, diff: diff)

        case .survey:
            // Read-only: every member chat's change summary, plus which safe copies
            // are changing the same files (the pre-combine overlap check).
            guard let from = request.from, let me = session(withID: from) else {
                return .failure("unknown sender session")
            }
            // The lead agent may look across the project boundary with an explicit
            // `--path`; for every other chat the boundary holds — its own project
            // is the only one it can survey.
            let project: String
            if let explicit = request.target, !explicit.isEmpty, me.isLeadAgent {
                project = explicit
            } else if let p = me.projectPath {
                project = p
            } else {
                return .failure("this chat isn't in a project")
            }
            let members = allSessions.filter { $0.projectPath == project && !$0.isProjectAgent }
            var copies: [IPCCopyStatus] = []
            var pathOwners: [String: [String]] = [:]
            for s in members {
                let dir = s.workingDirectory ?? project
                let base = s.safeCopy?.baseCommit ?? "HEAD"
                let d = WorktreeService.diff(worktree: dir, base: base)
                let files = d?.files ?? []
                copies.append(IPCCopyStatus(id: s.id, label: s.label, isolated: s.safeCopy != nil,
                                            branch: s.safeCopy?.branch, changedFiles: files.count,
                                            ahead: d?.ahead ?? 0))
                // Only separate copies can *clash* — shared-tree chats already point
                // at the same files, which isn't a copy conflict.
                if s.safeCopy != nil {
                    for f in files { pathOwners[f.path, default: []].append(s.id) }
                }
            }
            let overlaps = pathOwners.filter { $0.value.count > 1 }
                .map { IPCOverlap(path: $0.key, ids: $0.value) }
            let summary = overlaps.isEmpty
                ? "No two copies are changing the same files."
                : "\(overlaps.count) file\(overlaps.count == 1 ? "" : "s") "
                  + "\(overlaps.count == 1 ? "is" : "are") being changed in more than one copy — "
                  + "worth a look before combining."
            return IPCResponse(ok: true, survey: IPCSurvey(copies: copies, overlaps: overlaps, summary: summary))

        case .combinePlan:
            // Read-only: propose an order to combine the project's safe copies,
            // with a trial (no-op) conflict check. Changes nothing.
            guard let from = request.from, let me = session(withID: from) else {
                return .failure("unknown sender session")
            }
            // Same boundary rule as `survey`: only the lead crosses it.
            let project: String
            if let explicit = request.target, !explicit.isEmpty, me.isLeadAgent {
                project = explicit
            } else if let p = me.projectPath {
                project = p
            } else {
                return .failure("this chat isn't in a project")
            }
            let target = (request.body?.isEmpty == false) ? request.body! : project
            let isolated = allSessions.filter { $0.projectPath == project && $0.safeCopy != nil }
            var items: [IPCCombinePlanItem] = []
            var pathOwners: [String: [String]] = [:]
            for s in isolated {
                guard let sc = s.safeCopy else { continue }
                let d = WorktreeService.diff(worktree: sc.worktreePath, base: sc.baseCommit)
                let files = d?.files ?? []
                for f in files { pathOwners[f.path, default: []].append(s.id) }
                let unsaved = !WorktreeService.isClean(sc.worktreePath)
                let trialStr: String
                if unsaved {
                    trialStr = "needs-save"   // trial merge can't see work that isn't a checkpoint yet
                } else {
                    switch WorktreeService.trialMerge(into: "HEAD", incoming: sc.branch, in: target) {
                    case .clean: trialStr = "clean"
                    case .conflicts(let p): trialStr = "conflicts:\(p.count)"
                    case .unknown: trialStr = "unknown"
                    }
                }
                items.append(IPCCombinePlanItem(id: s.id, label: s.label, branch: sc.branch,
                                                changedFiles: files.count, hasUnsavedWork: unsaved,
                                                trialResult: trialStr))
            }
            // Safest first: copies that trial-merge clean, then the rest.
            let order = items.sorted { ($0.trialResult == "clean" ? 0 : 1) < ($1.trialResult == "clean" ? 0 : 1) }
            let overlaps = pathOwners.filter { $0.value.count > 1 }
                .map { IPCOverlap(path: $0.key, ids: $0.value) }
            let summary: String
            if items.isEmpty {
                summary = "There are no separate copies to combine — the chats share the main version."
            } else {
                summary = "\(items.count) cop\(items.count == 1 ? "y" : "ies") to bring in"
                        + (overlaps.isEmpty ? ", none changing the same files."
                                            : ", \(overlaps.count) file(s) changed in more than one — review those first.")
            }
            return IPCResponse(ok: true, combinePlan: IPCCombinePlan(order: order, overlaps: overlaps, summary: summary))

        case .combineApply:
            // The one mutating combine step, for ONE copy, and it is safe:
            // snapshot the copy's work, refuse a dirty target, then merge — aborting
            // and reporting on any conflict so nothing is ever silently lost, and
            // never deleting the source. `target` = the source chat; `body` = an
            // optional folder to combine into (defaults to the source's project).
            guard let t = request.target else {
                return .failure("say which chat's work to bring in")
            }
            let src: TerminalSession
            switch resolveTarget(t, from: request.from) {
            case .success(let found): src = found
            case .failure(let error): return .failure(error.message)
            }
            guard let sc = src.safeCopy else {
                return .failure("this chat is already working in the main version — there's nothing separate to bring in")
            }
            let into = (request.body?.isEmpty == false) ? request.body! : (src.projectPath ?? "")
            guard !into.isEmpty else { return .failure("there's no main version to bring this into") }
            // 1. Snapshot the copy's own work into a checkpoint (safe, recoverable).
            WorktreeService.snapshot(worktree: sc.worktreePath, message: "Work from \(src.label)")
            // 2. Never combine into a folder with unsaved changes.
            guard WorktreeService.isClean(into) else {
                return IPCResponse(ok: true, combineResult: IPCCombineResult(
                    status: "blocked", files: [], conflicts: [], recoveryPoint: nil,
                    summary: "The main version has unsaved changes, so I've left everything exactly "
                           + "as it is. Save or set those aside first, then I can bring this copy in."))
            }
            // 3. Merge, rolling back untouched on any conflict.
            let result: IPCCombineResult
            switch WorktreeService.merge(incomingBranch: sc.branch, into: into) {
            case .merged(let recovery, let files):
                result = IPCCombineResult(status: "merged", files: files, conflicts: [],
                    recoveryPoint: recovery,
                    summary: "Brought \(src.label)'s changes into the main version — "
                           + "\(files.count) file\(files.count == 1 ? "" : "s"). "
                           + "Nothing was lost, and we can go back to how it was if you want.")
            case .conflict(let conflicts, let recovery):
                result = IPCCombineResult(status: "conflict", files: [], conflicts: conflicts,
                    recoveryPoint: recovery,
                    summary: "\(src.label)'s work clashes with what's already in the main version, in "
                           + "\(conflicts.count) file\(conflicts.count == 1 ? "" : "s"). I've left everything "
                           + "untouched — nothing was combined. For each, we need to pick which version to keep.")
            case .failed(let why):
                result = IPCCombineResult(status: "blocked", files: [], conflicts: [],
                                          recoveryPoint: nil, summary: why)
            }
            // Combine trouble is fleet news: the lead should hear promptly that
            // a piece is parked, without anyone having to poll for it.
            fleetMonitor?.noteCombine(project: into, status: result.status)
            return IPCResponse(ok: true, combineResult: result)

        case .verify:
            // Handled off the main thread in `handleVerify` (see `startIPCIfNeeded`);
            // this branch only exists to keep the switch exhaustive.
            return handleVerify(request)
        }
    }

    /// `verify` runs the project's build, which can take many seconds — far too
    /// long to hold the main thread. Resolve the target session on main (model
    /// access), then run the build on whatever background thread the IPC hub
    /// called us on.
    private func handleVerify(_ request: IPCRequest) -> IPCResponse {
        var authError: String?
        var dir: String?
        var storedCheck: String?
        let resolve = {
            guard self.isAuthorized(request) else {
                authError = "unauthorized: missing or invalid IDEALIZE_TOKEN"; return
            }
            guard let t = request.target ?? request.from else { authError = "unknown chat"; return }
            switch self.resolveTarget(t, from: request.from) {
            case .success(let s):
                dir = s.workingDirectory
                storedCheck = s.verifyCommand
            case .failure(let e): authError = e.message
            }
        }
        if Thread.isMainThread { resolve() } else { DispatchQueue.main.sync(execute: resolve) }
        if let authError { return .failure(authError) }
        guard let dir, !dir.isEmpty else { return .failure("this chat has no folder to check") }
        // A one-off `--check` wins for this run only (never stored), else the
        // check attached at spawn, else the built-in autodetect.
        let check = (request.check?.isEmpty == false) ? request.check : storedCheck
        return IPCResponse(ok: true, verify: WorktreeService.verify(dir, check: check))
    }

    /// Whether the request carries the per-instance capability token. Compared
    /// as raw bytes (Data equality) rather than early-exit string shortcuts.
    private func isAuthorized(_ request: IPCRequest) -> Bool {
        guard let token = request.token, !token.isEmpty else { return false }
        return Data(token.utf8) == Data(ipcToken.utf8)
    }

    /// Resolve a target string to a session by id, then by alias, then by
    /// tab/label, then by project directory name. A name matching several
    /// sessions is an ambiguity error listing the candidates — never a silent
    /// pick of the first. `from` is the calling session's id, when known: the
    /// `coordinator` alias means *the caller's own project's* coordinator, so
    /// with several projects coordinated the sender decides which one resolves.
    private func resolveTarget(_ target: String, from: String? = nil)
        -> Result<TerminalSession, TargetResolutionError> {
        if let exact = session(withID: target) { return .success(exact) }
        let lower = target.lowercased()
        // A friendly alias for the workspace's lead agent, so any session can
        // report upward without knowing its id.
        if lower == "lead" || lower == "lead-agent" {
            if let lead = leadAgentSession { return .success(lead) }
            return .failure(TargetResolutionError(message: "no lead agent is running"))
        }
        // A friendly alias for the project's coordinating chat, so any session —
        // even one started before it — can reach it without knowing its id.
        if lower == "coordinator" || lower == "project-agent" {
            // The sender's own project's agent wins; first-match-globally would
            // misroute the moment two projects are coordinated.
            if let from, let senderProject = session(withID: from)?.projectPath,
               let own = projectAgentSession(forProject: senderProject) {
                return .success(own)
            }
            let agents = allSessions.filter { $0.isProjectAgent }
            switch agents.count {
            case 1: return .success(agents[0])
            case 0: return .failure(TargetResolutionError(message: "no project agent is running"))
            default:
                let ids = agents.map(\.id).joined(separator: ", ")
                return .failure(TargetResolutionError(
                    message: "several project agents are running (\(ids)) — use a session id"))
            }
        }
        var matches = allSessions.filter { $0.label.lowercased() == lower }
        if matches.isEmpty {
            matches = allSessions.filter { s in
                guard let p = s.projectPath else { return false }
                return (p as NSString).lastPathComponent.lowercased() == lower
            }
        }
        switch matches.count {
        case 1:
            return .success(matches[0])
        case 0:
            return .failure(TargetResolutionError(message: "no session matching '\(target)'"))
        default:
            let ids = matches.map(\.id).joined(separator: ", ")
            return .failure(TargetResolutionError(message: "'\(target)' matches \(matches.count) sessions (\(ids)) — use a session id"))
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
