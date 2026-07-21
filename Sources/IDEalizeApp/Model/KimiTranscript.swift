import Foundation
import CryptoKit

/// Kimi Code (Moonshot's CLI agent). Transcript is Kimi's own append-only
/// "wire" JSONL under `~/.kimi-code/sessions/`. Like `ClaudeTranscript`, this
/// is NOT an API integration — it only reads files Kimi already writes.
///
/// Wire records we depend on (protocol_version 1.4 — pinned here so a Kimi
/// upgrade that breaks one shows up in review, and the reader fails soft):
///  - `turn.prompt`            user input; `origin.kind == "user"` = real prompt
///  - `context.append_loop_event` → `event.type == "content.part"` →
///    `part.type == "text"` assistant prose (`"think"` = reasoning, skipped)
///  - `usage.record`           token usage (inputOther + caches = context fill)
///  - `llm.request`            `maxTokens` = the model's context window
///  - `step.begin`/`step.end`  (inside loop events) working/idle inference
struct KimiAgentProfile: AgentProfile {
    let id = "kimi"
    let displayName = "Kimi"
    let capabilities = AgentCapabilities(
        modelPicker: false, effortPicker: false, permissionMenus: false,
        contextGauge: true, resumable: true, statusAndTip: false)

    /// Working state comes from the wire tail, not screen markers.
    let workingMarkers: [String] = []

    /// Kimi's TUI draws its welcome quickly but swallows input for a few more
    /// seconds (verified by PTY test: submit at +2s was lost, +5s landed).
    let inputReadyDelay: TimeInterval = 4.0

    func matches(_ command: String) -> Bool {
        AgentCommandMatcher.command(command, invokes: "kimi")
    }

    /// Kimi cannot pre-seed a session id (`--session` only resumes), so the
    /// launch goes out untouched and the reader discovers the session dir.
    func augmentLaunch(_ command: String) -> (command: String, plannedSessionId: String?) {
        (command, nil)
    }

    func launchCommand(resuming sessionId: String?, settings: AppSettings) -> String {
        let configured = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = matches(configured) ? configured : "kimi"
        guard let sessionId else { return base }
        return "kimi --session \(sessionId)"
    }

    func makeReader(cwd: String, plannedSessionId: String?, launchedAt: Date) -> AgentTranscriptReader {
        KimiTranscriptReader(cwd: cwd, launchedAt: launchedAt)
    }
}

/// Locates and parses one Kimi session's wire.jsonl.
///
/// Session binding: Kimi mints its own session id at launch, so the reader
/// watches `~/.kimi-code/sessions/wd_<name>_<hash>/` for a `session_*` dir
/// created after our launch, and latches on only once confirmed — the wire
/// echoes the first message this pane submitted (two tabs launched in the same
/// folder each bind to the dir that carries *their* first message). A pane
/// whose user talks directly in the TUI (nothing submitted through the chat)
/// binds optimistically after 10s when exactly one candidate exists.
final class KimiTranscriptReader: AgentTranscriptReader {
    /// Symlink-resolved cwd — Kimi hashes the resolved path (verified:
    /// `/tmp/...` sessions land under the `/private/tmp/...` hash).
    private let cwd: String
    private let launchedAt: Date
    private var boundWire: URL?
    private var firstSubmitted: String?

    init(cwd: String, launchedAt: Date) {
        self.cwd = URL(fileURLWithPath: cwd).resolvingSymlinksInPath().path
        self.launchedAt = launchedAt
    }

    func noteSubmitted(_ text: String) {
        if firstSubmitted == nil { firstSubmitted = text }
    }

    /// The resumable id (`kimi --session <id>`) — the session dir's basename,
    /// e.g. "session_5da2c65c-…". wire = <session dir>/agents/main/wire.jsonl.
    var sessionId: String? {
        boundWire?.deletingLastPathComponent()          // agents/main
            .deletingLastPathComponent()                // agents
            .deletingLastPathComponent()                // session_<uuid>
            .lastPathComponent
    }

    // MARK: Locate & bind

    /// `wd_<cwd-basename.lowercased>_<sha256(cwd)[:12]>` — Kimi's project-dir
    /// naming scheme (verified against real sessions).
    private var projectDir: URL {
        let hash = SHA256.hash(data: Data(cwd.utf8))
            .map { String(format: "%02x", $0) }.joined().prefix(12)
        let name = "wd_" + (cwd as NSString).lastPathComponent.lowercased() + "_" + hash
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".kimi-code/sessions", isDirectory: true)
            .appendingPathComponent(name, isDirectory: true)
    }

    func currentTranscriptURL() -> URL? {
        if let bound = boundWire {
            return FileManager.default.fileExists(atPath: bound.path) ? bound : nil
        }
        let candidates = sessionCandidates()
        guard !candidates.isEmpty else { return nil }

        // Confirmed binding: the wire that echoes our first submitted message
        // is unambiguously ours.
        if let nonce = firstSubmitted {
            for wire in candidates where wireContainsPrompt(wire, matching: nonce) {
                boundWire = wire
                return wire
            }
            return nil   // our message hasn't landed anywhere yet — keep waiting
        }

        // Nothing submitted through the chat (user talks in the TUI directly):
        // after a settle period, a single candidate is safe to adopt.
        if candidates.count == 1, Date().timeIntervalSince(launchedAt) > 10 {
            boundWire = candidates[0]
            return candidates[0]
        }
        return nil
    }

    /// Wire files of sessions created around/after our launch in this cwd's
    /// project dir, newest first.
    private func sessionCandidates() -> [URL] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.creationDateKey, .isDirectoryKey]
        guard let dirs = try? fm.contentsOfDirectory(
            at: projectDir, includingPropertiesForKeys: keys) else { return [] }
        func created(_ url: URL) -> Date {
            (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
        }
        return dirs
            .filter { $0.lastPathComponent.hasPrefix("session_") }
            .filter { created($0) >= launchedAt.addingTimeInterval(-5) }
            .sorted { created($0) > created($1) }
            .map { $0.appendingPathComponent("agents/main/wire.jsonl") }
            .filter { fm.fileExists(atPath: $0.path) }
    }

    private func wireContainsPrompt(_ wire: URL, matching text: String) -> Bool {
        let needle = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return false }
        guard let raw = try? String(contentsOf: wire, encoding: .utf8) else { return false }
        for line in raw.split(separator: "\n") {
            guard let obj = Self.json(line), (obj["type"] as? String) == "turn.prompt" else { continue }
            let prompt = Self.promptText(obj).trimmingCharacters(in: .whitespacesAndNewlines)
            if prompt == needle || (needle.count > 24 && prompt.contains(needle.prefix(64))) {
                return true
            }
        }
        return false
    }

    // MARK: Parse

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
            guard let obj = Self.json(line), let type = obj["type"] as? String else { continue }
            if type == "turn.prompt" {
                // Real user input only — `turn.steer` (injected notifications)
                // never opens an exchange, mirroring Claude's <system-reminder>
                // filter. origin.kind guards any future non-user prompt source.
                guard ((obj["origin"] as? [String: Any])?["kind"] as? String) == "user" else { continue }
                let t = Self.promptText(obj)
                guard !t.isEmpty else { continue }
                flush(); question = t; answer = nil
            } else if type == "context.append_loop_event", question != nil {
                // Assistant prose arrives as complete text parts (verified: not
                // streaming deltas). Latest part wins — Kimi narrates interim
                // "Let me look…" parts before the real answer, exactly like
                // Claude's interim messages, and the same rule applies.
                guard let event = obj["event"] as? [String: Any],
                      (event["type"] as? String) == "content.part",
                      let part = event["part"] as? [String: Any],
                      (part["type"] as? String) == "text",
                      let text = part["text"] as? String else { continue }
                let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { answer = t }
            }
        }
        flush()
        return out
    }

    func contextUsage(in url: URL) -> AgentContextUsage? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var latestTokens: Int?
        var latestLimit: Int?
        for line in raw.split(separator: "\n") {
            guard let obj = Self.json(line), let type = obj["type"] as? String else { continue }
            if type == "usage.record", let usage = obj["usage"] as? [String: Any] {
                func n(_ key: String) -> Int { (usage[key] as? NSNumber)?.intValue ?? 0 }
                // Context fill = the input carried into the turn (fresh + cached);
                // `output` is newly generated, not context until the next turn.
                let total = n("inputOther") + n("inputCacheRead") + n("inputCacheCreation")
                if total > 0 { latestTokens = total }
            } else if type == "llm.request", let max = (obj["maxTokens"] as? NSNumber)?.intValue, max > 0 {
                latestLimit = max
            }
        }
        guard let tokens = latestTokens else { return nil }
        return AgentContextUsage(tokens: tokens, limit: latestLimit ?? ClaudeTranscript.defaultContextWindowLimit)
    }

    /// Working/idle from the wire tail: mid-step records mean Kimi is
    /// generating; a step boundary means it's (at least momentarily) idle —
    /// the caller's existing 1.5s working grace bridges inter-step gaps, the
    /// same way it bridges Claude's spinner flicker.
    func isGenerating(in url: URL) -> Bool? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        let tail: UInt64 = 65_536
        let offset = size > tail ? size - tail : 0
        try? handle.seek(toOffset: offset)
        guard let data = try? handle.readToEnd(),
              let raw = String(data: data, encoding: .utf8) else { return nil }
        var lines = raw.split(separator: "\n")
        if offset > 0, !lines.isEmpty { lines.removeFirst() }   // skip the partial first line
        var generating: Bool?
        for line in lines {
            guard let obj = Self.json(line), let type = obj["type"] as? String else { continue }
            switch type {
            case "turn.prompt", "turn.steer":
                generating = true
            case "usage.record", "turn.cancel":
                generating = false
            case "context.append_loop_event":
                switch (obj["event"] as? [String: Any])?["type"] as? String {
                case "step.begin", "content.part", "tool.call", "tool.result":
                    generating = true
                case "step.end":
                    generating = false
                default: break
                }
            default: break   // config/metadata records say nothing about work
            }
        }
        return generating
    }

    // MARK: Helpers

    private static func json(_ line: Substring) -> [String: Any]? {
        guard let data = line.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// Joined text parts of a `turn.prompt`'s input array.
    private static func promptText(_ obj: [String: Any]) -> String {
        guard let input = obj["input"] as? [[String: Any]] else { return "" }
        return input
            .filter { ($0["type"] as? String) == "text" }
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
