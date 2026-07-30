import Foundation

/// Wire protocol shared between the IDEalize app (server) and the `idealize` CLI (client).
///
/// Transport: a Unix domain socket. Each request/response is a single line of
/// JSON terminated by `\n`. This keeps the CLI side trivially synchronous while
/// the app side can multiplex many connections.
public enum IPC {
    /// Default socket path. Overridable via the `IDEALIZE_SOCK` environment
    /// variable so multiple app instances (or tests) can coexist.
    public static var socketPath: String {
        if let override = ProcessInfo.processInfo.environment["IDEALIZE_SOCK"], !override.isEmpty {
            return override
        }
        // The dev build (.dev bundle id) uses its own runtime dir so it can run
        // alongside the installed app without fighting over the socket/token. The
        // CLI (a separate process) matches via the injected IDEALIZE_SOCK above.
        let dirName = (Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true) ? "IDEalize Dev" : "IDEalize"
        let base = NSHomeDirectory() + "/Library/Application Support/\(dirName)"
        return base + "/ipc.sock"
    }

    /// Environment variable the app injects into every spawned shell so a
    /// process (e.g. Claude Code) knows which session it belongs to.
    public static let sessionEnvKey = "IDEALIZE_SESSION_ID"

    /// Environment variable carrying the per-app-instance capability token that
    /// authorizes mutating IPC commands. The app generates one at startup and
    /// injects it into every spawned shell.
    public static let tokenEnvKey = "IDEALIZE_TOKEN"

    /// Where the app mirrors the capability token (mode 0600), so a CLI invoked
    /// outside an IDEalize-spawned shell (e.g. via a symlink) can still
    /// authenticate. Lives beside the socket.
    public static var tokenFilePath: String {
        (socketPath as NSString).deletingLastPathComponent + "/ipc.token"
    }

    /// The capability token for this process: `$IDEALIZE_TOKEN` if set, else
    /// the contents of the app's token file. nil when neither exists.
    public static func loadToken() -> String? {
        if let t = ProcessInfo.processInfo.environment[tokenEnvKey], !t.isEmpty { return t }
        guard let data = FileManager.default.contents(atPath: tokenFilePath),
              let t = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
              !t.isEmpty else { return nil }
        return t
    }
}

/// A request sent from the CLI to the app.
public struct IPCRequest: Codable, Sendable {
    public enum Command: String, Codable, Sendable {
        case ping
        case list          // list active sessions
        case notify        // show a system notification
        case send          // deliver a message to a target session's mailbox
        case broadcast     // deliver a message to every session except sender
        case inbox         // drain the calling session's mailbox
        case peek          // read the mailbox without draining
        case setStatus     // set a custom status string for a session/tab
        case focus         // bring a session's tab to the foreground
        case blocks        // list captured command blocks for a session
        case input         // type text into a session's terminal (exec)
        case reveal        // select a file in the app's file explorer
        case transcript    // read a session's recent chat exchanges
        case note          // read (or, with a body, set) the project's shared note
        case agentHello    // an unknown agent introduces itself (handshake); body = descriptor JSON
        case spawn         // start a new chat (optionally in target project) with body as its opening task
        case gitDiff       // read-only: a chat's changes vs a base (its safe copy's base, or origin/main)
        case survey        // read-only: each chat's change summary + which copies touch the same files
        case verify        // run the project's build/check in a chat's folder; pass/fail + output tail
        case combinePlan   // read-only: proposed order to combine copies, with a trial conflict check
        case combineApply  // bring one copy's work into the main version (gated; aborts on conflict)
    }

    public var command: Command
    /// Identity of the calling session (from `IDEALIZE_SESSION_ID`), if any.
    public var from: String?
    /// Capability token (`IDEALIZE_TOKEN`) authorizing mutating commands.
    public var token: String?
    /// Target session id, name, or project path (interpretation depends on command).
    public var target: String?
    /// Free-form message body / notification text.
    public var body: String?
    /// Optional title (used by `notify`).
    public var title: String?
    /// Optional sound flag for notifications.
    public var sound: Bool?
    /// Used by `reveal`: also open the file in the document panel.
    public var open: Bool?
    /// Used by `transcript`: max number of recent exchanges to return.
    public var limit: Int?
    /// Used by `spawn`: start the new chat in its own isolated safe copy.
    public var isolated: Bool?
    /// Used by `spawn`: a short label for the new chat's tab, so a delegated piece
    /// of work is identifiable in the sidebar instead of being "Chat 4". The caller
    /// knows what the piece *is*, which a brief's opening words often don't say —
    /// when it's absent the app falls back to deriving one from the task.
    public var name: String?

    public init(command: Command,
                from: String? = nil,
                token: String? = nil,
                target: String? = nil,
                body: String? = nil,
                title: String? = nil,
                sound: Bool? = nil,
                open: Bool? = nil,
                limit: Int? = nil,
                isolated: Bool? = nil,
                name: String? = nil) {
        self.command = command
        self.from = from
        self.token = token
        self.target = target
        self.body = body
        self.title = title
        self.sound = sound
        self.open = open
        self.limit = limit
        self.isolated = isolated
        self.name = name
    }
}

/// A single inter-agent message held in a session mailbox.
public struct IPCMessage: Codable, Sendable {
    public var from: String
    public var fromLabel: String?
    public var body: String
    public var timestamp: Date

    public init(from: String, fromLabel: String? = nil, body: String, timestamp: Date) {
        self.from = from
        self.fromLabel = fromLabel
        self.body = body
        self.timestamp = timestamp
    }
}

/// A captured command block, returned by `blocks`.
public struct IPCBlock: Codable, Sendable {
    public var command: String
    public var cwd: String?
    public var exitCode: Int32?
    public var running: Bool
    public var durationMs: Int?

    public init(command: String, cwd: String?, exitCode: Int32?, running: Bool, durationMs: Int?) {
        self.command = command
        self.cwd = cwd
        self.exitCode = exitCode
        self.running = running
        self.durationMs = durationMs
    }
}

/// One question/answer pair from a chat's transcript, returned by `transcript`.
/// Lets an agent (e.g. a project agent) read what another chat has been doing.
public struct IPCExchange: Codable, Sendable {
    public var index: Int
    public var question: String
    public var answer: String?

    public init(index: Int, question: String, answer: String?) {
        self.index = index
        self.question = question
        self.answer = answer
    }
}

/// Lightweight description of a live session, returned by `list`.
public struct IPCSessionInfo: Codable, Sendable {
    public var id: String
    public var title: String
    public var projectPath: String?
    public var processName: String?
    public var status: String?
    public var unread: Int
    /// What the session is in the coordination hierarchy: "lead",
    /// "project-agent", or "chat". Optional so old CLIs (and old app builds)
    /// decode each other's messages unchanged.
    public var role: String?

    public init(id: String, title: String, projectPath: String?, processName: String?,
                status: String?, unread: Int, role: String? = nil) {
        self.id = id
        self.title = title
        self.projectPath = projectPath
        self.processName = processName
        self.status = status
        self.unread = unread
        self.role = role
    }
}

/// One changed file in a chat's `diff`. `added`/`deleted` are nil for new
/// (untracked) or binary files. `change` is a plain word: "changed", "new",
/// "binary" — never raw git status codes.
public struct IPCDiffFile: Codable, Sendable {
    public var path: String
    public var added: Int?
    public var deleted: Int?
    public var change: String
    public init(path: String, added: Int?, deleted: Int?, change: String) {
        self.path = path; self.added = added; self.deleted = deleted; self.change = change
    }
}

/// What a chat has changed versus a base point, returned by `gitDiff`. `branch`
/// and `base` are engineering detail for the agent's own reasoning; `summary` is
/// the plain-language line safe to relay to the user.
public struct IPCDiff: Codable, Sendable {
    public var branch: String
    public var base: String
    public var ahead: Int
    public var behind: Int
    public var files: [IPCDiffFile]
    public var summary: String
    public init(branch: String, base: String, ahead: Int, behind: Int, files: [IPCDiffFile], summary: String) {
        self.branch = branch; self.base = base; self.ahead = ahead; self.behind = behind
        self.files = files; self.summary = summary
    }
}

/// One chat's line in a `survey`.
public struct IPCCopyStatus: Codable, Sendable {
    public var id: String
    public var label: String
    public var isolated: Bool
    public var branch: String?
    public var changedFiles: Int
    public var ahead: Int
    public init(id: String, label: String, isolated: Bool, branch: String?, changedFiles: Int, ahead: Int) {
        self.id = id; self.label = label; self.isolated = isolated
        self.branch = branch; self.changedFiles = changedFiles; self.ahead = ahead
    }
}

/// A file that more than one safe copy is changing — a potential clash to look
/// at before combining.
public struct IPCOverlap: Codable, Sendable {
    public var path: String
    public var ids: [String]
    public init(path: String, ids: [String]) { self.path = path; self.ids = ids }
}

/// The project-wide picture returned by `survey`: each chat's change count and
/// any files being changed in more than one copy.
public struct IPCSurvey: Codable, Sendable {
    public var copies: [IPCCopyStatus]
    public var overlaps: [IPCOverlap]
    public var summary: String
    public init(copies: [IPCCopyStatus], overlaps: [IPCOverlap], summary: String) {
        self.copies = copies; self.overlaps = overlaps; self.summary = summary
    }
}

/// Result of `verify`. `ran` is false when the folder has no known check (then
/// `passed` is nil and `summary` says so honestly, never faking a pass).
public struct IPCVerify: Codable, Sendable {
    public var ran: Bool
    public var passed: Bool?
    public var check: String
    public var tail: String
    public var summary: String
    public init(ran: Bool, passed: Bool?, check: String, tail: String, summary: String) {
        self.ran = ran; self.passed = passed; self.check = check; self.tail = tail; self.summary = summary
    }
}

/// One copy's line in a combine plan. `trialResult` is a plain token
/// ("clean", "conflicts:N", "needs-save", "unknown") from a *trial* merge that
/// changes nothing.
public struct IPCCombinePlanItem: Codable, Sendable {
    public var id: String
    public var label: String
    public var branch: String?
    public var changedFiles: Int
    public var hasUnsavedWork: Bool
    public var trialResult: String
    public init(id: String, label: String, branch: String?, changedFiles: Int, hasUnsavedWork: Bool, trialResult: String) {
        self.id = id; self.label = label; self.branch = branch
        self.changedFiles = changedFiles; self.hasUnsavedWork = hasUnsavedWork; self.trialResult = trialResult
    }
}

/// The read-only proposal returned by `combinePlan`: a suggested order (safest
/// first), overlaps, and a plain summary. Nothing is changed by computing it.
public struct IPCCombinePlan: Codable, Sendable {
    public var order: [IPCCombinePlanItem]
    public var overlaps: [IPCOverlap]
    public var summary: String
    public init(order: [IPCCombinePlanItem], overlaps: [IPCOverlap], summary: String) {
        self.order = order; self.overlaps = overlaps; self.summary = summary
    }
}

/// Outcome of a single `combineApply`. `status` is one of "merged", "conflict",
/// "blocked", "nothing". On "conflict" nothing was changed (the attempt was
/// rolled back); `recoveryPoint` records the point the main version can be taken
/// back to, so a combine is never a one-way door.
public struct IPCCombineResult: Codable, Sendable {
    public var status: String
    public var files: [String]
    public var conflicts: [String]
    public var recoveryPoint: String?
    public var summary: String
    public init(status: String, files: [String], conflicts: [String], recoveryPoint: String?, summary: String) {
        self.status = status; self.files = files; self.conflicts = conflicts
        self.recoveryPoint = recoveryPoint; self.summary = summary
    }
}

/// The response sent from the app back to the CLI.
public struct IPCResponse: Codable, Sendable {
    public var ok: Bool
    public var error: String?
    public var sessions: [IPCSessionInfo]?
    public var messages: [IPCMessage]?
    public var blocks: [IPCBlock]?
    public var exchanges: [IPCExchange]?
    public var info: String?
    /// `spawn`: whether the new chat actually got its own safe copy (false when
    /// isolation was requested but the folder couldn't support it).
    public var isolated: Bool?
    public var diff: IPCDiff?
    public var survey: IPCSurvey?
    public var verify: IPCVerify?
    public var combinePlan: IPCCombinePlan?
    public var combineResult: IPCCombineResult?

    public init(ok: Bool,
                error: String? = nil,
                sessions: [IPCSessionInfo]? = nil,
                messages: [IPCMessage]? = nil,
                blocks: [IPCBlock]? = nil,
                exchanges: [IPCExchange]? = nil,
                info: String? = nil,
                isolated: Bool? = nil,
                diff: IPCDiff? = nil,
                survey: IPCSurvey? = nil,
                verify: IPCVerify? = nil,
                combinePlan: IPCCombinePlan? = nil,
                combineResult: IPCCombineResult? = nil) {
        self.ok = ok
        self.error = error
        self.sessions = sessions
        self.messages = messages
        self.blocks = blocks
        self.exchanges = exchanges
        self.info = info
        self.isolated = isolated
        self.diff = diff
        self.survey = survey
        self.verify = verify
        self.combinePlan = combinePlan
        self.combineResult = combineResult
    }

    public static func failure(_ message: String) -> IPCResponse {
        IPCResponse(ok: false, error: message)
    }
}

public extension IPC {
    /// Shared JSON coder configuration so both ends agree on date encoding.
    static func makeEncoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }

    static func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }
}
