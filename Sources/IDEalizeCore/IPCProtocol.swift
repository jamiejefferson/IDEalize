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
        let base = NSHomeDirectory() + "/Library/Application Support/IDEalize"
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

    public init(command: Command,
                from: String? = nil,
                token: String? = nil,
                target: String? = nil,
                body: String? = nil,
                title: String? = nil,
                sound: Bool? = nil,
                open: Bool? = nil,
                limit: Int? = nil) {
        self.command = command
        self.from = from
        self.token = token
        self.target = target
        self.body = body
        self.title = title
        self.sound = sound
        self.open = open
        self.limit = limit
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

    public init(id: String, title: String, projectPath: String?, processName: String?, status: String?, unread: Int) {
        self.id = id
        self.title = title
        self.projectPath = projectPath
        self.processName = processName
        self.status = status
        self.unread = unread
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

    public init(ok: Bool,
                error: String? = nil,
                sessions: [IPCSessionInfo]? = nil,
                messages: [IPCMessage]? = nil,
                blocks: [IPCBlock]? = nil,
                exchanges: [IPCExchange]? = nil,
                info: String? = nil) {
        self.ok = ok
        self.error = error
        self.sessions = sessions
        self.messages = messages
        self.blocks = blocks
        self.exchanges = exchanges
        self.info = info
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
