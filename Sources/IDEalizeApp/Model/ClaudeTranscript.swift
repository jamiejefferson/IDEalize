import Foundation

/// Reads Claude Code's own session transcript — the JSONL it writes under
/// `~/.claude/projects/<encoded-cwd>/<session>.jsonl` — to surface Claude's
/// latest completed assistant message. This is NOT a native-AI/API integration:
/// it only reads files Claude Code already produces on disk.
enum ClaudeTranscript {
    /// Claude Code derives the transcript directory name from a project's cwd by
    /// replacing every non-alphanumeric character with '-'.
    static func encodedDir(for path: String) -> String {
        String(path.map { ($0.isLetter || $0.isNumber) ? $0 : "-" })
    }

    private static func projectsRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/projects", isDirectory: true)
    }

    /// The newest transcript file for a given working directory, if any.
    static func newestTranscript(forCwd cwd: String) -> URL? {
        let dir = projectsRoot().appendingPathComponent(encodedDir(for: cwd), isDirectory: true)
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: keys) else { return nil }
        return items
            .filter { $0.pathExtension == "jsonl" }
            .max { a, b in modDate(a) < modDate(b) }
    }

    /// The transcript for a specific session id under a project's cwd, if it
    /// exists yet. Used to read exactly the Claude we launched (`--session-id`).
    static func transcript(forCwd cwd: String, sessionId: String) -> URL? {
        let url = projectsRoot()
            .appendingPathComponent(encodedDir(for: cwd), isDirectory: true)
            .appendingPathComponent(sessionId + ".jsonl")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func modDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    /// The default context window (tokens) before Claude Code auto-compacts, used
    /// as the denominator when a turn's model is unknown. The 1M-context models
    /// override this — see `contextWindowLimit(forModel:)`.
    static let defaultContextWindowLimit = 200_000

    /// The extended (1M-token) window some Claude models offer.
    static let extendedContextWindowLimit = 1_000_000

    /// The usable context window for a turn, given its model id and the tokens it
    /// was observed carrying. Claude Code marks a 1M-context session with a `[1m]`
    /// suffix on the model (e.g. `claude-opus-4-8[1m]`) — but the transcript often
    /// logs the bare model id even for a 1M session, so we also treat any turn
    /// already holding more than the standard window as proof of the larger one.
    /// Everything else uses the standard ~200k window. The readout is a guide for
    /// "when to start a fresh chat", not an exact mirror of Claude's own gauge.
    static func contextWindowLimit(forModel model: String?, tokens: Int = 0) -> Int {
        if model?.contains("[1m]") ?? false { return extendedContextWindowLimit }
        return tokens > defaultContextWindowLimit ? extendedContextWindowLimit : defaultContextWindowLimit
    }

    /// The newest turn's context usage: the tokens it carries (input + cache-read
    /// + cache-creation of the last assistant message with usage — what actually
    /// fills the window) paired with the window that same turn's model allows.
    /// `nil` when the transcript has no usage yet. Read to show a per-chat "how
    /// full is this conversation" gauge, so you can see when to archive it and
    /// move to a fresh chat.
    struct ContextUsage: Equatable {
        let tokens: Int
        let limit: Int
        var fraction: Double { min(1, Double(tokens) / Double(limit)) }
    }

    static func contextUsage(in url: URL) -> ContextUsage? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var latestTokens: Int?
        var latestModel: String?
        for line in raw.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (obj["type"] as? String) == "assistant",
                  let message = obj["message"] as? [String: Any],
                  let usage = message["usage"] as? [String: Any] else { continue }
            func n(_ key: String) -> Int { (usage[key] as? NSNumber)?.intValue ?? 0 }
            let total = n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens")
            if total > 0 {                       // last turn with real usage wins
                latestTokens = total
                latestModel = message["model"] as? String
            }
        }
        guard let tokens = latestTokens else { return nil }
        return ContextUsage(tokens: tokens, limit: contextWindowLimit(forModel: latestModel, tokens: tokens))
    }

    /// One real user prompt and Claude's reply to it. `answer` is nil while
    /// Claude is still working (no assistant text has followed the prompt yet).
    struct Exchange: Equatable, Identifiable {
        let index: Int
        let question: String
        let answer: String?
        var id: Int { index }
    }

    /// Every Q&A turn in the transcript, oldest→newest. Each real user prompt
    /// opens an exchange; the last assistant text before the next prompt is its
    /// answer (mirroring `lastExchange`'s "latest block wins" behaviour). Powers
    /// the chat's back/forward history navigation.
    static func allExchanges(in url: URL) -> [AgentExchange] {
        let follower = Follower(url: url)
        _ = follower.poll()
        return follower.exchanges
    }

    /// Incremental reader for one transcript file: remembers the byte offset
    /// already consumed (and any partial-line remainder) between polls, so
    /// appended content is read and parsed exactly once instead of re-parsing
    /// the whole (possibly multi-MB) file on every change.
    final class Follower {
        let url: URL
        private var offset: UInt64 = 0
        private var remainder = Data()
        private var complete: [AgentExchange] = []
        private var question: String?
        private var answer: String?

        init(url: URL) { self.url = url }

        /// All exchanges parsed so far, including the pending (unflushed) tail.
        var exchanges: [AgentExchange] {
            guard let q = question else { return complete }
            return complete + [AgentExchange(index: complete.count, question: q, answer: answer)]
        }

        /// Parse the bytes appended since the last poll. Returns true when
        /// `exchanges` changed. A truncated/rotated file (now smaller than the
        /// consumed offset) is re-parsed from scratch.
        func poll() -> Bool {
            guard let fh = try? FileHandle(forReadingFrom: url) else { return false }
            defer { try? fh.close() }
            let size = fh.seekToEndOfFile()
            if size < offset {
                offset = 0
                remainder.removeAll(keepingCapacity: true)
                complete.removeAll(keepingCapacity: true)
                question = nil
                answer = nil
            }
            guard size > offset else { return false }
            fh.seek(toFileOffset: offset)
            let data = fh.readData(ofLength: Int(size - offset))
            offset += UInt64(data.count)
            var buffer = remainder
            buffer.append(data)
            remainder.removeAll(keepingCapacity: true)
            var changed = false
            var start = buffer.startIndex
            // Process complete lines only; keep the partial tail for next time.
            while let nl = buffer[start...].firstIndex(of: 0x0A) {
                let line = buffer[start..<nl]
                start = buffer.index(after: nl)
                if !line.isEmpty, fold(Data(line)) { changed = true }
            }
            remainder = Data(buffer[start...])
            return changed
        }

        /// Fold one transcript line into the running Q&A state. Returns true
        /// when it changed the parsed exchanges.
        private func fold(_ line: Data) -> Bool {
            guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let type = obj["type"] as? String else { return false }
            if type == "user", let t = ClaudeTranscript.userText(obj), ClaudeTranscript.isUserPrompt(t) {
                if let q = question {
                    complete.append(AgentExchange(index: complete.count, question: q, answer: answer))
                }
                question = t
                answer = nil
                return true
            }
            if type == "assistant", let t = ClaudeTranscript.assistantText(obj), question != nil, t != answer {
                answer = t
                return true
            }
            return false
        }
    }

    /// The latest user prompt and Claude's answer to it. `answer` is nil while
    /// Claude is still working (the most recent message is the user's question
    /// with no assistant reply after it yet).
    static func lastExchange(in url: URL) -> AgentExchange? {
        allExchanges(in: url).last
    }

    private static func assistantText(_ obj: [String: Any]) -> String? {
        guard let message = obj["message"] as? [String: Any] else { return nil }
        if let s = message["content"] as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        guard let content = message["content"] as? [[String: Any]] else { return nil }
        let texts = content.compactMap { block -> String? in
            (block["type"] as? String) == "text" ? block["text"] as? String : nil
        }
        let joined = texts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }

    private static func userText(_ obj: [String: Any]) -> String? {
        guard let message = obj["message"] as? [String: Any] else { return nil }
        if let s = message["content"] as? String {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        if let content = message["content"] as? [[String: Any]] {
            let texts = content.compactMap { block -> String? in
                (block["type"] as? String) == "text" ? block["text"] as? String : nil
            }
            let joined = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            return joined.isEmpty ? nil : joined
        }
        return nil
    }

    /// Filter out Claude Code's machine-injected "user" turns (tool results,
    /// system reminders, command wrappers) so only real prompts surface.
    private static func isUserPrompt(_ t: String) -> Bool {
        if t.hasPrefix("<") { return false }
        if t.hasPrefix("Caveat:") { return false }
        if t.contains("<command-name>") || t.contains("<system-reminder>")
            || t.contains("<local-command-stdout>") { return false }
        return true
    }
}
