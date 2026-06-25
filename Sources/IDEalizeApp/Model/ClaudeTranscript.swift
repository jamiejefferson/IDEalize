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
    static func allExchanges(in url: URL) -> [Exchange] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        var out: [Exchange] = []
        var question: String?
        var answer: String?
        func flush() {
            guard let q = question else { return }
            out.append(Exchange(index: out.count, question: q, answer: answer))
        }
        for line in raw.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = obj["type"] as? String else { continue }
            if type == "user", let t = userText(obj), isUserPrompt(t) {
                flush(); question = t; answer = nil
            } else if type == "assistant", let t = assistantText(obj), question != nil {
                answer = t
            }
        }
        flush()
        return out
    }

    /// The latest user prompt and Claude's answer to it. `answer` is nil while
    /// Claude is still working (the most recent message is the user's question
    /// with no assistant reply after it yet).
    static func lastExchange(in url: URL) -> (question: String?, answer: String?) {
        guard let last = allExchanges(in: url).last else { return (nil, nil) }
        return (last.question, last.answer)
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
