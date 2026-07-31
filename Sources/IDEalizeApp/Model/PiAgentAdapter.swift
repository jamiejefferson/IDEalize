import Foundation

/// Adapter for the Pi coding agent CLI (`pi`).
struct PiAgentAdapter: AgentAdapter {
    let name = "Pi"
    let binaryName = "pi"

    func matches(command: String) -> Bool {
        command.range(of: "(^|[ /&;])pi($| )", options: .regularExpression) != nil
    }

    var launchCommand: String? { "pi" }

    /// Pi accepts an exact session id at launch (`--session-id`, "creating it if
    /// missing"), so a chat can bind its transcript the same way a Claude chat
    /// does. These flags mean the command already picks its own session, so a
    /// second id must not be appended.
    var sessionIdLaunchFlag: String? { "--session-id" }
    var sessionSelectorFlags: [String] {
        ["--session-id", "--session", "--session-dir", "--continue", "--resume",
         "--fork", "--no-session", "-c", "-r"]
    }

    func resumeCommand(sessionId: String) -> String? {
        "pi --session \(sessionId)"
    }

    func sessionId(fromTranscriptURL url: URL) -> String? {
        // Pi transcripts are ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<session-uuid>.jsonl.
        let base = url.deletingPathExtension().lastPathComponent
        guard let sep = base.range(of: "_", options: .backwards) else { return nil }
        let id = String(base[sep.upperBound...])
        return id.isEmpty ? nil : id
    }

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? {
        // A session we launched carries its own `--session-id`, so bind to that
        // file and nothing else — the same "never follow a sibling's transcript"
        // contract as the Claude adapter. Pi only writes the file on the first
        // message, so this stays nil (and the chat shows nothing) until it appears.
        if let id = sessionId {
            return PiTranscript.transcript(forCwd: cwd, sessionId: id)
        }
        // Only genuinely unbound (hand-started) chats fall back to the newest.
        return PiTranscript.newestTranscript(forCwd: cwd)
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        PiTranscript.allExchanges(in: url)
    }

    func lastExchange(in url: URL) -> AgentExchange? {
        PiTranscript.lastExchange(in: url)
    }

    func parsePrompt(lines: [String]) -> AgentPrompt? {
        AgentPromptParser.parse(lines)
    }

    func detectWorkingState(lines: [String]) -> AgentWorkingState {
        // Pi's status indicator shows "Working..." while a turn runs, later
        // suffixed with "(esc to interrupt)"; retries and compaction show their
        // own spinner lines. The idle welcome's key hints read "escape interrupt"
        // (no "to"), so they don't false-positive here.
        let working = lines.contains { l in
            let s = l.lowercased()
            return s.contains("working...") || s.contains("to interrupt")
                || s.contains("retrying (") || s.contains("compacting")
        }
        return AgentWorkingState(isWorking: working, status: nil, tip: nil)
    }

    var supportsRuntimeModelSwitch: Bool { false }   // `/model` opens a picker, not a direct switch
    var supportsReasoningEffort: Bool { false }      // thinking level is a launch/TUI setting, not a keyword
    var supportedSlashCommands: [String] { [] }
    var modelSwitchCommand: String? { nil }
    var effortKeywords: [String: String] { [:] }
}

/// Reads Pi's session transcript — the JSONL it writes under
/// `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl` — to
/// surface the latest completed assistant message. This is NOT a native-AI/API
/// integration: it only reads files Pi already produces on disk.
enum PiTranscript {
    private static func sessionsRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi/agent/sessions", isDirectory: true)
    }

    /// Pi derives the session directory name from a project's cwd by dropping
    /// the leading slash, replacing every `/`, `\` and `:` with '-', and
    /// wrapping the result in double dashes.
    static func encodedDir(for path: String) -> String {
        var p = path
        while p.hasPrefix("/") || p.hasPrefix("\\") { p.removeFirst() }
        let cleaned = p.map { (c: Character) -> Character in
            (c == "/" || c == "\\" || c == ":") ? "-" : c
        }
        return "--" + String(cleaned) + "--"
    }

    private static func sessionDir(forCwd cwd: String) -> URL {
        // Pi names the directory after its process's getcwd(), which resolves
        // symlinks — e.g. /tmp/... is really /private/tmp/... — while IDEalize
        // carries the path as the user gave it. POSIX realpath(3), not
        // Foundation's resolvingSymlinksInPath, is what matches getcwd():
        // Foundation deliberately keeps /tmp and strips /private.
        var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
        let physical = realpath(cwd, &buf).map { String(cString: $0) } ?? cwd
        return sessionsRoot().appendingPathComponent(encodedDir(for: physical), isDirectory: true)
    }

    /// The transcript for a specific session id under a project's cwd, if it
    /// exists yet. The filename's timestamp prefix isn't predictable, so the
    /// directory is scanned for the `_<sessionId>.jsonl` suffix.
    static func transcript(forCwd cwd: String, sessionId: String) -> URL? {
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: sessionDir(forCwd: cwd), includingPropertiesForKeys: nil) else { return nil }
        return items.first { $0.lastPathComponent.hasSuffix("_\(sessionId).jsonl") }
    }

    /// The newest transcript file for a given working directory, if any.
    static func newestTranscript(forCwd cwd: String) -> URL? {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: sessionDir(forCwd: cwd), includingPropertiesForKeys: keys) else { return nil }
        return items
            .filter { $0.pathExtension == "jsonl" }
            .max { modDate($0) < modDate($1) }
    }

    private static func modDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    /// Every Q&A turn in the session file, oldest→newest. Pi writes one JSON
    /// object per line; user and assistant turns share `type: "message"` with
    /// the role inside, and tool output arrives under its own `toolResult` role
    /// (never surfaced as a question or answer).
    static func allExchanges(in url: URL) -> [AgentExchange] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        var out: [AgentExchange] = []
        var question: String?
        var answerParts: [String] = []

        func flush() {
            guard let q = question else { return }
            let answer = answerParts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            out.append(AgentExchange(index: out.count, question: q, answer: answer.isEmpty ? nil : answer))
        }

        for line in raw.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  obj["type"] as? String == "message",
                  let message = obj["message"] as? [String: Any],
                  let role = message["role"] as? String,
                  let content = message["content"] as? [[String: Any]] else { continue }

            let texts = content
                .filter { $0["type"] as? String == "text" }
                .compactMap { $0["text"] as? String }

            switch role {
            case "user":
                let joined = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !joined.isEmpty else { continue }
                flush()
                question = joined
                answerParts = []
            case "assistant":
                for text in texts {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { answerParts.append(trimmed) }
                }
            default:
                break   // toolResult and friends never surface in the chat
            }
        }
        flush()
        return out
    }

    static func lastExchange(in url: URL) -> AgentExchange? {
        allExchanges(in: url).last
    }
}
