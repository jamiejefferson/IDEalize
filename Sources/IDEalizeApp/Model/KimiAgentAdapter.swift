import Foundation

/// Adapter for Kimi Code CLI (`kimi`).
struct KimiAgentAdapter: AgentAdapter {
    let name = "Kimi"
    let binaryName = "kimi"

    func matches(command: String) -> Bool {
        command.range(of: "(^|[ /&;])kimi($| )", options: .regularExpression) != nil
    }

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? {
        // Kimi doesn't accept a --session-id at launch the way Claude does, so we
        // can't bind a session id ahead of time. Instead we find the newest Kimi
        // session whose recorded working directory matches ours.
        KimiTranscript.newestSession(forCwd: cwd)
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        KimiTranscript.allExchanges(in: url)
    }

    func lastExchange(in url: URL) -> AgentExchange? {
        KimiTranscript.lastExchange(in: url)
    }

    func parsePrompt(lines: [String]) -> AgentPrompt? {
        AgentPromptParser.parse(lines)
    }

    func detectWorkingState(lines: [String]) -> AgentWorkingState {
        // Kimi's TUI shows a working indicator with a spinner and a status line.
        // Until we have a sampled prompt format, reuse the generic screen parser
        // for prompts and look for Kimi-specific working markers.
        let working = lines.contains { l in
            let s = l.lowercased()
            return s.contains("working")
                || s.contains("thinking")
                || s.contains("esc to interrupt")
                || s.contains("tokens")
        }
        let (status, tip) = AgentPromptParser.statusAndTip(lines)
        return AgentWorkingState(isWorking: working, status: status, tip: tip)
    }

    var supportsRuntimeModelSwitch: Bool { false }   // model is chosen at launch with -m
    var supportsReasoningEffort: Bool { false }
    var supportedSlashCommands: [String] { ["/flows"] }
    var modelSwitchCommand: String? { nil }
    var effortKeywords: [String: String] { [:] }
}

/// Reads Kimi Code's session wire format — the JSONL it writes under
/// `~/.kimi-code/sessions/<workdir-hash>/<session>/agents/main/wire.jsonl` — to
/// surface the latest completed assistant message. This is NOT a native-AI/API
/// integration: it only reads files Kimi Code already produces on disk.
enum KimiTranscript {
    /// Root directory where Kimi stores sessions.
    private static func sessionsRoot() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".kimi-code/sessions", isDirectory: true)
    }

    /// The newest wire transcript for a given working directory, if any.
    static func newestSession(forCwd cwd: String) -> URL? {
        let root = sessionsRoot()
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let workdirDirs = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: keys) else {
            return nil
        }
        var candidates: [(url: URL, mtime: Date)] = []
        for workdirDir in workdirDirs where workdirDir.hasDirectoryPath {
            guard let sessionDirs = try? fm.contentsOfDirectory(at: workdirDir, includingPropertiesForKeys: keys) else {
                continue
            }
            for sessionDir in sessionDirs where sessionDir.hasDirectoryPath {
                let stateURL = sessionDir.appendingPathComponent("state.json")
                guard let data = try? Data(contentsOf: stateURL),
                      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let workDir = obj["workDir"] as? String,
                      workDir == cwd else { continue }
                let wire = sessionDir.appendingPathComponent("agents/main/wire.jsonl")
                guard fm.fileExists(atPath: wire.path) else { continue }
                let mtime = modDate(wire)
                candidates.append((wire, mtime))
            }
        }
        return candidates.max { $0.mtime < $1.mtime }?.url
    }

    static func modDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
    }

    /// Every Q&A turn in the wire file, oldest→newest.
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
                  let type = obj["type"] as? String else { continue }

            switch type {
            case "turn.prompt":
                if let input = obj["input"] as? [[String: Any]],
                   let first = input.first,
                   first["type"] as? String == "text",
                   let text = first["text"] as? String {
                    flush()
                    question = text
                    answerParts = []
                }
            case "context.append_message":
                if let message = obj["message"] as? [String: Any],
                   message["role"] as? String == "user",
                   let content = message["content"] as? [[String: Any]] {
                    let texts = content.compactMap { $0["text"] as? String }
                    let joined = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !joined.isEmpty {
                        flush()
                        question = joined
                        answerParts = []
                    }
                }
            case "context.append_loop_event":
                if let event = obj["event"] as? [String: Any],
                   event["type"] as? String == "content.part",
                   let part = event["part"] as? [String: Any],
                   part["type"] as? String == "text",
                   let text = part["text"] as? String {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        answerParts.append(trimmed)
                    }
                }
            default:
                break
            }
        }
        flush()
        return out
    }

    static func lastExchange(in url: URL) -> AgentExchange? {
        allExchanges(in: url).last
    }
}
