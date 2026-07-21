import Foundation

/// What an unknown agent taught us about itself during the first-run
/// introduction (the in-chat handshake): where its transcript lives and how to
/// read it. LLM-supplied, so it is verified (path under $HOME, nonce when one
/// was issued) before being trusted, and only ever used to *read*.
struct HandshakeAgentDescriptor: Codable, Equatable {
    var displayName: String
    /// Absolute path with `{cwd}` / `{home}` placeholders. nil when the agent
    /// couldn't name one (`format == "none"` → chat works without bubbles).
    var transcriptPathTemplate: String?
    /// "jsonl" | "none" (json/text may join later; anything unknown = "none").
    var format: String
    /// Record filters/extractors for the generic JSONL reader: dot-path == value.
    var userMatch: [String: String]?
    var userTextPath: String?
    var assistantMatch: [String: String]?
    var assistantTextPath: String?
    var contextTokensPath: String?
    var contextLimit: Int?
    /// Relaunch template for resuming, e.g. "aider --restore {id}". Only ever
    /// run from a user-initiated reopen.
    var resumeTemplate: String?
    var learnedAt: Date
    /// The verification checks passed (path bounds; nonce when one was issued).
    var verified: Bool

    /// Can this descriptor actually feed the chat bubbles?
    var readable: Bool { format == "jsonl" && transcriptPathTemplate != nil && verified }

    /// Resolve the path template against a session's cwd.
    func transcriptURL(cwd: String) -> URL? {
        guard let template = transcriptPathTemplate else { return nil }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let resolvedCwd = URL(fileURLWithPath: cwd).resolvingSymlinksInPath().path
        var path = template
            .replacingOccurrences(of: "{home}", with: home)
            .replacingOccurrences(of: "{cwd}", with: resolvedCwd)
            .replacingOccurrences(of: "~", with: home)
        path = (path as NSString).standardizingPath
        // Read-only trust boundary: never follow a descriptor outside $HOME.
        guard path.hasPrefix(home + "/") else { return nil }
        return URL(fileURLWithPath: path)
    }
}

/// A Tier-2 profile built from a cached handshake descriptor: the agent told
/// us its name and transcript once, and from then on it gets the same chat
/// surface as a built-in — minus the capabilities it couldn't describe.
struct HandshakeAgentProfile: AgentProfile {
    let token: String                       // launch command's first word, the cache key
    let descriptor: HandshakeAgentDescriptor

    var id: String { "hs:\(token)" }
    var displayName: String { descriptor.displayName }

    var capabilities: AgentCapabilities {
        AgentCapabilities(
            modelPicker: false, effortPicker: false, permissionMenus: false,
            contextGauge: descriptor.readable && descriptor.contextTokensPath != nil,
            resumable: descriptor.resumeTemplate != nil,
            statusAndTip: false)
    }

    /// Generic "some TUI is busy" markers: spinner glyphs most CLI agents use,
    /// plus the interrupt hints they print while working.
    var workingMarkers: [String] {
        ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏", "esc to", "ctrl+c to"]
    }

    /// Unknown TUIs get a conservative settle before the first message lands.
    var inputReadyDelay: TimeInterval { 3.0 }

    func matches(_ command: String) -> Bool {
        HandshakeAgentProfile.commandToken(command) == token
    }

    func augmentLaunch(_ command: String) -> (command: String, plannedSessionId: String?) {
        (command, nil)
    }

    func launchCommand(resuming sessionId: String?, settings: AppSettings) -> String {
        let configured = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = matches(configured) ? configured : token
        guard let sessionId, let template = descriptor.resumeTemplate,
              template.contains("{id}") else { return base }
        return template.replacingOccurrences(of: "{id}", with: sessionId)
    }

    func makeReader(cwd: String, plannedSessionId: String?, launchedAt: Date) -> AgentTranscriptReader {
        GenericJSONLTranscriptReader(descriptor: descriptor, cwd: cwd)
    }

    // MARK: Registry hooks

    /// The bare program name a command line invokes ("/usr/local/bin/aider -m x"
    /// → "aider") — the handshake cache's key.
    static func commandToken(_ command: String) -> String? {
        guard let first = command
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ").first else { return nil }
        let token = (String(first) as NSString).lastPathComponent.lowercased()
        return token.isEmpty ? nil : token
    }

    /// The learned profile for a command, if its first token is in the cache.
    /// `format: "none"` entries (the agent couldn't help) resolve to nil so the
    /// pane behaves like a plain terminal rather than an empty chat.
    static func forCommand(_ command: String, settings: AppSettings) -> AgentProfile? {
        guard let token = commandToken(command),
              let descriptor = settings.agentHandshakeCache[token],
              descriptor.format != "none" else { return nil }
        return HandshakeAgentProfile(token: token, descriptor: descriptor)
    }

    /// The learned profile for a persisted agent id ("hs:<token>").
    static func forId(_ id: String, settings: AppSettings) -> AgentProfile? {
        guard id.hasPrefix("hs:") else { return nil }
        let token = String(id.dropFirst(3))
        guard let descriptor = settings.agentHandshakeCache[token],
              descriptor.format != "none" else { return nil }
        return HandshakeAgentProfile(token: token, descriptor: descriptor)
    }
}

/// Reads a handshake-described JSONL transcript with a tiny mapping language:
/// dot-path equality filters pick out user/assistant records, dot-path
/// extractors pull their text. Anything the language can't express simply
/// yields no exchanges — the chat then leans on the terminal view, never on
/// garbage.
final class GenericJSONLTranscriptReader: AgentTranscriptReader {
    private let descriptor: HandshakeAgentDescriptor
    private let cwd: String

    init(descriptor: HandshakeAgentDescriptor, cwd: String) {
        self.descriptor = descriptor
        self.cwd = cwd
    }

    /// Handshake descriptors describe a file, not a session id — archives of
    /// these chats reopen fresh unless a future hello supplies one.
    var sessionId: String? { nil }

    func currentTranscriptURL() -> URL? {
        guard descriptor.readable, let url = descriptor.transcriptURL(cwd: cwd),
              FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        var out: [AgentExchange] = []
        var question: String?
        var answer: String?
        func flush() {
            guard let q = question else { return }
            out.append(AgentExchange(index: out.count, question: q, answer: answer))
        }
        for line in raw.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { continue }
            if Self.record(obj, matches: descriptor.userMatch),
               let t = Self.text(at: descriptor.userTextPath, in: obj) {
                flush(); question = t; answer = nil
            } else if Self.record(obj, matches: descriptor.assistantMatch),
                      let t = Self.text(at: descriptor.assistantTextPath, in: obj) {
                if question != nil { answer = t }
            }
        }
        flush()
        return out
    }

    func contextUsage(in url: URL) -> AgentContextUsage? {
        guard let path = descriptor.contextTokensPath,
              let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var latest: Int?
        for line in raw.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let n = Self.value(at: path, in: obj) as? NSNumber, n.intValue > 0
            else { continue }
            latest = n.intValue
        }
        guard let tokens = latest else { return nil }
        return AgentContextUsage(
            tokens: tokens,
            limit: descriptor.contextLimit ?? ClaudeTranscript.defaultContextWindowLimit)
    }

    // MARK: Mapping language

    /// Every filter key ("type", "message.role", …) must equal its value.
    private static func record(_ obj: [String: Any], matches filters: [String: String]?) -> Bool {
        guard let filters, !filters.isEmpty else { return false }
        return filters.allSatisfy { key, expected in
            (value(at: key, in: obj) as? String) == expected
        }
    }

    /// Walk a dot path ("message.content") through nested dictionaries.
    private static func value(at path: String, in obj: [String: Any]) -> Any? {
        var current: Any? = obj
        for key in path.split(separator: ".") {
            current = (current as? [String: Any])?[String(key)]
        }
        return current
    }

    /// Extract text at a dot path: a plain string, or a Claude-style array of
    /// blocks (`[{type: "text", text: …}]` / `["…"]`), joined.
    private static func text(at path: String?, in obj: [String: Any]) -> String? {
        guard let path else { return nil }
        let raw = value(at: path, in: obj)
        var joined: String
        if let s = raw as? String {
            joined = s
        } else if let blocks = raw as? [Any] {
            joined = blocks.compactMap { block -> String? in
                if let s = block as? String { return s }
                if let d = block as? [String: Any] {
                    if let t = d["text"] as? String { return t }
                }
                return nil
            }.joined(separator: "\n\n")
        } else {
            return nil
        }
        joined = joined.trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }
}
