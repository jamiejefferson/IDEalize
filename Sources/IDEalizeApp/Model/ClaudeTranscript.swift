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

    static func modDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    /// The latest user prompt and Claude's answer to it. `answer` is nil while
    /// Claude is still working (the most recent message is the user's question
    /// with no assistant reply after it yet).
    static func lastExchange(in url: URL) -> (question: String?, answer: String?) {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return (nil, nil) }
        var question: String?
        var answer: String?
        var questionIdx = -1
        var answerIdx = -1
        var i = 0
        for line in raw.split(separator: "\n") {
            defer { i += 1 }
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = obj["type"] as? String else { continue }
            if type == "user", let t = userText(obj), isUserPrompt(t) {
                question = t; questionIdx = i
            } else if type == "assistant", let t = assistantText(obj) {
                answer = t; answerIdx = i
            }
        }
        // Only show the answer if it came after the latest question.
        return (question, answerIdx > questionIdx ? answer : nil)
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
