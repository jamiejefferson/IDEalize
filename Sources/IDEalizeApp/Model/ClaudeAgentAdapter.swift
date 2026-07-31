import Foundation

/// Adapter for Claude Code CLI (`claude`).
struct ClaudeAgentAdapter: AgentAdapter {
    let name = "Claude"
    let binaryName = "claude"

    func matches(command: String) -> Bool {
        command.range(of: "(^|[ /&;])claude($| )", options: .regularExpression) != nil
    }

    var launchCommand: String? { "claude --dangerously-skip-permissions" }

    var sessionIdLaunchFlag: String? { "--session-id" }
    var sessionSelectorFlags: [String] {
        ["--session-id", "--resume", "--continue", "-r", "-c"]
    }

    func resumeCommand(sessionId: String) -> String? {
        "claude --dangerously-skip-permissions --resume \(sessionId)"
    }

    func sessionId(fromTranscriptURL url: URL) -> String? {
        // Claude transcripts are ~/.claude/projects/<dir>/<session-uuid>.jsonl.
        url.deletingPathExtension().lastPathComponent
    }

    func transcriptURL(forCwd cwd: String, sessionId: String?) -> URL? {
        // A session we launched carries its own `--session-id`, so it owns exactly
        // one transcript file. Bind to that file and nothing else: every chat and
        // the project agent in one project share a single transcript directory
        // (it's keyed only on cwd), so falling back to "newest in the directory"
        // here would hand a bound chat a *sibling's* transcript — most often the
        // project agent's, whose file is perpetually the newest because the
        // coordinator polls on a timer. That cross-session read is what made fresh
        // chats mirror the coordinator and blended content between chats.
        //
        // If our own transcript doesn't exist yet, show nothing until it appears
        // rather than mirroring whatever ran last. (The old "stillborn → follow
        // newest" swap guarded against a double-launch that produced two
        // transcripts for one chat; `agentLaunchInFlight` now prevents that
        // double-launch upstream, and both launches would reuse the same
        // session-id/file anyway, so the swap is obsolete and only leaks.)
        if let id = sessionId {
            return ClaudeTranscript.transcript(forCwd: cwd, sessionId: id)
        }
        // Only genuinely unbound (hand-started, no session-id) chats fall back to
        // the newest transcript in the directory.
        return ClaudeTranscript.newestTranscript(forCwd: cwd)
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
    var modelSwitchCommand: String? { "/model" }
    var supportsReasoningEffort: Bool { true }
    var supportsPermissionModes: Bool { true }
    var supportedSlashCommands: [String] { ["/flow-review", "/flow-run", "/flow-improve", "/flows"] }
    var effortKeywords: [String: String] {
        ["Extended": "think", "Deep": "think hard", "Maximum": "ultrathink"]
    }
}
