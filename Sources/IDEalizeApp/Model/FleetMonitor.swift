import Foundation

/// Pure record of the fleet's shape over time — which projects have a
/// coordinating agent, and whose mailboxes are going unread — kept free of
/// app/terminal types so it can be unit-tested directly. Mirrors
/// `ActivityLedger`'s role for `ProjectMonitor`: deterministic signals only,
/// with all judgment left to the (LLM) agents the signals wake.
struct FleetLedger {

    /// One coordinated (or coordinatable) project as seen on a tick.
    struct ProjectState: Equatable {
        var path: String
        /// The project agent's session id, nil when the project is unwatched.
        var agentID: String?
        /// Worker chats currently open in the project (excluding the agent).
        var memberCount: Int
    }

    /// One coordination-tier session's mailbox as seen on a tick (the lead and
    /// every project agent — worker inboxes are their project agent's business).
    struct InboxState: Equatable {
        var sessionID: String
        var unread: Int
        /// Mid-task chats are left alone: their agent will drain the inbox when
        /// it surfaces, and a nudge would interrupt real work.
        var busy: Bool
    }

    enum Event: Equatable {
        /// A project gained a coordinating agent — worth a hello and a board line.
        case agentAppeared(project: String, agentID: String)
        /// A project's agent went away while worker chats remain — the project
        /// is now unwatched, which the lead should treat as a risk.
        case agentDisappeared(project: String, membersRemaining: Int)
        /// A coordination-tier session has sat idle on unread mail too long —
        /// mailbox-first messaging only works if someone tells it to look up.
        case staleInbox(sessionID: String, unread: Int)
    }

    /// How long unread mail may sit on an idle session before a nudge.
    var staleAfter: TimeInterval = 120

    /// Whether the first `observe` has run: the fleet's starting shape is
    /// baseline, not news — agents already running mustn't fire "appeared".
    private var primed = false
    private var knownAgents: [String: String] = [:]   // project path → agent id
    private var unreadSince: [String: Date] = [:]     // session id → first tick with mail
    private var nudgedStale: Set<String> = []         // one nudge per stale episode

    /// Digest one tick of fleet state into the events worth acting on.
    mutating func observe(projects: [ProjectState], inboxes: [InboxState],
                          at date: Date) -> [Event] {
        var events: [Event] = []

        for p in projects {
            let known = knownAgents[p.path]
            if let agent = p.agentID {
                if primed, known == nil {
                    events.append(.agentAppeared(project: p.path, agentID: agent))
                }
                knownAgents[p.path] = agent
            } else if known != nil {
                knownAgents[p.path] = nil
                if primed, p.memberCount > 0 {
                    events.append(.agentDisappeared(project: p.path,
                                                    membersRemaining: p.memberCount))
                }
            }
        }

        for inbox in inboxes {
            guard inbox.unread > 0 else {
                unreadSince[inbox.sessionID] = nil
                nudgedStale.remove(inbox.sessionID)
                continue
            }
            let since = unreadSince[inbox.sessionID] ?? date
            unreadSince[inbox.sessionID] = since
            if !inbox.busy,
               date.timeIntervalSince(since) >= staleAfter,
               !nudgedStale.contains(inbox.sessionID) {
                nudgedStale.insert(inbox.sessionID)
                events.append(.staleInbox(sessionID: inbox.sessionID, unread: inbox.unread))
            }
        }

        primed = true
        return events
    }
}

/// Watches the whole fleet while the lead agent's chat is open, turning the
/// ledger's deterministic signals — plus combine trouble reported by the IPC
/// handler — into throttled "heads-up" nudges. Fleet-level signals go to the
/// lead; a stale-inbox nudge goes to the session sitting on the mail, which is
/// what makes mailbox-first messaging prompt instead of eventual. No FSEvents
/// and no transcript reading: the per-project `ProjectMonitor`s already watch
/// files, and judgment stays in the agents.
final class FleetMonitor {
    private weak var workspace: Workspace?
    private weak var lead: TerminalSession?
    private var ledger = FleetLedger()
    private var pollTimer: Timer?

    /// Per-target queues, same discipline as `ProjectMonitor`: throttled,
    /// retried while the target is mid-prompt, never dropped.
    private var pendingNudges: [String: [String]] = [:]   // session id → texts
    private var lastNudgeAt: [String: Date] = [:]
    private let nudgeInterval: TimeInterval = 30

    init(lead: TerminalSession, workspace: Workspace) {
        self.lead = lead
        self.workspace = workspace
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.poll()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    func stop() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    deinit { stop() }

    /// The IPC handler reports every combine's outcome; trouble is worth the
    /// lead knowing about promptly — a conflict parks a piece until someone
    /// routes it back to the chat that owns it.
    func noteCombine(project: String, status: String) {
        guard status == "conflict" || status == "blocked", let lead else { return }
        let name = (project as NSString).lastPathComponent
        enqueue(for: lead.id,
                "Heads-up from IDEalize: a combine in \(name) came back \(status). "
                + "Nothing was lost, but the piece is parked — check with that project's "
                + "agent what it needs.")
    }

    private func poll() {
        guard let workspace, let lead else { return }
        let sessions = workspace.allSessions
        let byProject = Dictionary(grouping: sessions.filter {
            ProjectAgent.isCoordinatable($0.projectPath)
        }, by: { $0.projectPath! })
        let projects = byProject.map { path, members in
            FleetLedger.ProjectState(
                path: path,
                agentID: members.first(where: { $0.isProjectAgent })?.id,
                memberCount: members.filter { !$0.isProjectAgent }.count)
        }
        let inboxes = sessions.filter { $0.isLeadAgent || $0.isProjectAgent }.map {
            FleetLedger.InboxState(sessionID: $0.id, unread: $0.mailbox.count,
                                   busy: $0.botWorking)
        }
        for event in ledger.observe(projects: projects, inboxes: inboxes, at: Date()) {
            switch event {
            case .agentAppeared(let project, let agentID):
                let name = (project as NSString).lastPathComponent
                enqueue(for: lead.id,
                        "Heads-up from IDEalize: \(name) now has a project agent (\(agentID)). "
                        + "Say hello with `idealize send \(agentID) \"…\"` and add it to the board.")
            case .agentDisappeared(let project, let members):
                let name = (project as NSString).lastPathComponent
                enqueue(for: lead.id,
                        "Heads-up from IDEalize: \(name)'s project agent closed, and "
                        + "\(members) chat\(members == 1 ? " is" : "s are") still working there "
                        + "unwatched. Restart one with `idealize spawn --coordinator --path \(project)` "
                        + "if the project is still moving, and note it on the board.")
            case .staleInbox(let sessionID, let unread):
                enqueue(for: sessionID,
                        "Heads-up from IDEalize: \(unread) unread note\(unread == 1 ? "" : "s") "
                        + "waiting — run `idealize inbox`.")
            }
        }
        flushNudges()
    }

    private func enqueue(for sessionID: String, _ text: String) {
        pendingNudges[sessionID, default: []].append(text)
        flushNudges()
    }

    /// Deliver the next queued nudge per target — same guards as
    /// `ProjectMonitor.flushNudges`: throttled per target, held while the
    /// target's agent isn't up or is showing the user a prompt.
    private func flushNudges(at now: Date = Date()) {
        guard let workspace else { return }
        for (sessionID, texts) in pendingNudges {
            guard !texts.isEmpty else { continue }
            guard now.timeIntervalSince(lastNudgeAt[sessionID] ?? .distantPast) >= nudgeInterval,
                  let target = workspace.allSessions.first(where: { $0.id == sessionID }),
                  target.tuiActive, target.pendingPrompt == nil,
                  !target.liveInteractivePrompt else { continue }
            var queue = texts
            target.submitInput(queue.removeFirst())
            pendingNudges[sessionID] = queue
            lastNudgeAt[sessionID] = now
        }
    }
}
