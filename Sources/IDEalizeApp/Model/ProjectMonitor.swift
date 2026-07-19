import Foundation

/// Pure record of "who touched which file when" in a coordinated project,
/// kept free of app/terminal types so it can be unit-tested directly.
struct ActivityLedger {
    /// Who a file change is attributed to: a member chat, or `.external` when
    /// no chat was active (build output, the user saving in an editor…).
    enum Source: Equatable {
        case session(String)
        case external
    }

    struct Entry: Equatable {
        var path: String
        var source: Source
        var date: Date
    }

    private(set) var entries: [Entry] = []
    /// Per-file throttle: when an overlap was last reported for a path.
    private var lastReportedAt: [String: Date] = [:]

    /// How far back "recent" reaches when pairing two chats' touches.
    var window: TimeInterval = 15 * 60
    /// Minimum gap before the same file is reported as overlapping again.
    var cooldown: TimeInterval = 15 * 60

    /// Record a change to `path`. Returns the two chat ids when this change
    /// makes the file a *fresh* overlap — touched by two different chats within
    /// `window`, and not reported within `cooldown`. External changes never
    /// report (they're noise: builds, editors, the project agent's own notes).
    @discardableResult
    mutating func record(path: String, source: Source, at date: Date) -> (String, String)? {
        entries.append(Entry(path: path, source: source, date: date))
        if entries.count > 200 { entries.removeFirst(entries.count - 200) }
        guard case .session(let newcomer) = source else { return nil }
        let cutoff = date.addingTimeInterval(-window)
        let others = entries.compactMap { entry -> String? in
            guard entry.path == path, entry.date >= cutoff,
                  case .session(let id) = entry.source, id != newcomer else { return nil }
            return id
        }
        guard let other = others.last else { return nil }
        if let last = lastReportedAt[path], date.timeIntervalSince(last) < cooldown {
            return nil
        }
        lastReportedAt[path] = date
        return (other, newcomer)
    }
}

/// Watches a coordinated project's folder while its project agent chat is open,
/// turning raw filesystem events into plain-language "heads-up" nudges typed
/// into the project agent's chat: two chats touching the same file, or a new
/// chat joining the project. The project agent (an LLM) does the actual
/// reasoning about whether anything truly conflicts — this object only supplies
/// the deterministic signals, so all judgment stays out of the app.
final class ProjectMonitor {
    private let projectPath: String
    private weak var workspace: Workspace?
    private weak var coordinator: TerminalSession?
    private let watcher = DirectoryWatcher()
    private var ledger = ActivityLedger()
    private var pollTimer: Timer?

    /// Chat id → last time it was seen mid-task (drives attribution).
    private var lastWorkingAt: [String: Date] = [:]
    /// Chats already known about — new-chat nudges fire once per chat.
    private var knownChatIDs: Set<String> = []
    /// Nudges held back by the global throttle, oldest first.
    private var pendingNudges: [String] = []
    private var lastNudgeAt: Date = .distantPast
    /// Minimum gap between nudges so the project agent is never spammed.
    private let nudgeInterval: TimeInterval = 30
    /// A change is attributed to a chat seen working within this window.
    private let attributionWindow: TimeInterval = 5

    init(projectPath: String, coordinator: TerminalSession, workspace: Workspace) {
        self.projectPath = projectPath
        self.coordinator = coordinator
        self.workspace = workspace
        // Chats already open when the agent starts aren't "new".
        knownChatIDs = Set(memberSessions.map(\.id))
        watcher.start(path: projectPath) { [weak self] paths in
            self?.filesChanged(paths)
        }
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.poll()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    func stop() {
        watcher.stop()
        pollTimer?.invalidate()
        pollTimer = nil
    }

    deinit { stop() }

    /// Chats doing the project's work: every live session in this folder except
    /// the project agent itself.
    private var memberSessions: [TerminalSession] {
        (workspace?.allSessions ?? []).filter { $0.projectPath == projectPath && !$0.isProjectAgent }
    }

    /// FSEvents burst → ledger → maybe a nudge. Runs on the main queue.
    private func filesChanged(_ paths: [String]) {
        let now = Date()
        for path in paths where ProjectMonitor.isSignificant(path, within: projectPath) {
            if let (other, newcomer) = ledger.record(path: path, source: attribution(at: now), at: now) {
                let file = (path as NSString).lastPathComponent
                enqueueNudge(
                    "Heads-up from IDEalize: two chats in this project both changed `\(file)` recently "
                    + "(\(other) and \(newcomer)). Take a look — `idealize transcript \(other) --last 5` and "
                    + "`idealize transcript \(newcomer) --last 5` — and check their changes fit together. "
                    + "If they clash, ask the user which way to go."
                )
            }
        }
    }

    /// Who a change belongs to: the member chat seen working most recently, or
    /// `.external` when none was active (build output, the user in an editor).
    private func attribution(at now: Date) -> ActivityLedger.Source {
        let recent = memberSessions
            .compactMap { s -> (id: String, at: Date)? in
                guard let t = lastWorkingAt[s.id],
                      now.timeIntervalSince(t) <= attributionWindow else { return nil }
                return (s.id, t)
            }
            .max { $0.at < $1.at }
        return recent.map { .session($0.id) } ?? .external
    }

    /// 1 Hz: track which chats are working (for attribution), welcome new
    /// chats, and flush throttled nudges.
    private func poll() {
        let now = Date()
        for s in memberSessions where s.botWorking { lastWorkingAt[s.id] = now }
        for s in memberSessions where !knownChatIDs.contains(s.id) {
            knownChatIDs.insert(s.id)
            enqueueNudge(
                "Heads-up from IDEalize: a new chat (\(s.id)) just started in this project. "
                + "Say hello with `idealize type \(s.id) \"…\"` if useful, and keep track of "
                + "what it's working on."
            )
        }
        flushNudges(at: now)
    }

    private func enqueueNudge(_ text: String) {
        pendingNudges.append(text)
        flushNudges()
    }

    /// Type the next queued nudge into the project agent's chat — the same path
    /// the user's own input takes, so it lands as a visible message. Held back
    /// while throttled, while the agent isn't up yet, or while it's showing the
    /// user a prompt (an injected Return would answer it by accident). Queued
    /// nudges are retried on the next poll.
    private func flushNudges(at now: Date = Date()) {
        guard !pendingNudges.isEmpty,
              now.timeIntervalSince(lastNudgeAt) >= nudgeInterval,
              let agent = coordinator, agent.tuiActive,
              agent.pendingPrompt == nil, !agent.liveInteractivePrompt else { return }
        agent.submitInput(pendingNudges.removeFirst())
        lastNudgeAt = now
    }

    /// Paths worth reacting to: inside the project, skipping VCS internals,
    /// dependency folders, and dotfiles/dot-dirs. Dot-dirs cover `.idealize/`,
    /// the project agent's own notes — reacting to those would be a feedback
    /// loop.
    static func isSignificant(_ path: String, within root: String) -> Bool {
        guard path.hasPrefix(root + "/") else { return false }
        for component in path.dropFirst(root.count).split(separator: "/") {
            if component.hasPrefix(".") || component == "node_modules" { return false }
        }
        return true
    }
}
