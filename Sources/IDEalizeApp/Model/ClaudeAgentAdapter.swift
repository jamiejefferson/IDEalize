import Foundation

/// Adapter for Claude Code CLI (`claude`).
struct ClaudeAgentAdapter: AgentAdapter {
    let name = "Claude"
    let binaryName = "claude"

    func matches(command: String) -> Bool {
        command.range(of: "(^|[ /&;])claude($| )", options: .regularExpression) != nil
    }

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? {
        if let id = sessionId,
           let bound = ClaudeTranscript.transcript(forCwd: cwd, sessionId: id) {
            // Prefer the transcript for the session we launched. If it's stillborn
            // (no real exchange) and a newer transcript exists, the user is really
            // talking to that one — follow it.
            if let newest = ClaudeTranscript.newestTranscript(forCwd: cwd),
               newest != bound,
               ClaudeTranscript.modDate(newest) > ClaudeTranscript.modDate(bound),
               transcriptIsStillborn(bound) {
                return newest
            }
            return bound
        }
        return ClaudeTranscript.newestTranscript(forCwd: cwd)
    }

    private func transcriptIsStillborn(_ url: URL) -> Bool {
        let e = ClaudeTranscript.lastExchange(in: url)
        return e?.question == nil && e?.answer == nil
    }

    func allExchanges(in url: URL) -> [AgentExchange] {
        ClaudeTranscript.allExchanges(in: url)
    }

    func lastExchange(in url: URL) -> AgentExchange? {
        ClaudeTranscript.lastExchange(in: url)
    }

    func parsePrompt(lines: [String]) -> AgentPrompt? {
        AgentPromptParser.parse(lines)
    }

    func detectWorkingState(lines: [String]) -> AgentWorkingState {
        let (status, tip) = AgentPromptParser.statusAndTip(lines)
        let markerVisible = lines.contains { l in
            let s = l.lowercased()
            return s.contains("esc to inter")
                || s.contains("esc to canc")
                || s.contains("to interrupt")
                || s.contains("ctrl+t to")
                || s.contains("· interrupt")
        }
        return AgentWorkingState(isWorking: markerVisible, status: status, tip: tip)
    }

    var supportsRuntimeModelSwitch: Bool { true }
    var supportsReasoningEffort: Bool { true }
    var supportedSlashCommands: [String] { ["/flow-review", "/flow-run", "/flow-improve", "/flows"] }
    var modelSwitchCommand: String? { "/model" }
    var effortKeywords: [String: String] {
        ["Extended": "think", "Deep": "think hard", "Maximum": "ultrathink"]
    }
}
