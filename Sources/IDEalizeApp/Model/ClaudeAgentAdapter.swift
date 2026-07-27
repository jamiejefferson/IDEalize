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

    func detectLoginState(lines: [String]) -> AgentLoginState {
        func any(_ needles: [String]) -> Bool {
            lines.contains { line in
                let s = line.lowercased()
                return needles.contains { s.contains($0) }
            }
        }
        // "Login successful" / "Logged in as …" are the terminal's own success
        // confirmations. Both are unambiguously positive — unlike "not logged in"
        // or "… · Run /login", which are prompts to sign in, not confirmations.
        // Claude pauses on the success screen for Enter, so the 1 Hz poll catches
        // it reliably.
        if any(["login successful", "logged in as"]) { return .succeeded }
        // The sign-in flow itself: the method picker, the browser hand-off, the
        // paste-the-code prompt, and the retry/failure footer.
        if any(["select login method", "opening browser to sign in",
                "opening browser to authorize", "paste code here",
                "press enter to retry", "browser didn't open",
                "browser did not open", "claude.ai/oauth"]) { return .inProgress }
        return .none
    }

    var supportsRuntimeModelSwitch: Bool { true }
    var supportsReasoningEffort: Bool { true }
    var supportedSlashCommands: [String] { ["/flow-review", "/flow-run", "/flow-improve", "/flows"] }
    var modelSwitchCommand: String? { "/model" }
    var effortKeywords: [String: String] {
        ["Extended": "think", "Deep": "think hard", "Maximum": "ultrathink"]
    }
}
