import Foundation

/// How much of the chat GUI a hosted agent's integration can drive. Anything
/// off simply hides (or no-ops) that surface — the core chat (composer,
/// bubbles, status badge, chime) works for every agent.
struct AgentCapabilities {
    var modelPicker: Bool       // the toolbar model pill (sends `/model …`)
    var effortPicker: Bool      // the effort pill ("think" keywords)
    var permissionMenus: Bool   // ClaudePromptParser's numbered-menu buttons
    var contextGauge: Bool      // the per-chat context meter
    var resumable: Bool         // an archived chat can be reopened mid-conversation
    var statusAndTip: Bool      // the footer status line / "Tip:" parsing
}

/// Identity + behavior of a CLI coding agent IDEalize can host in chat mode.
/// `TerminalSession` stays agent-agnostic by routing every agent-specific
/// decision (detection, launch augmentation, transcript reading, working
/// markers) through the resolved profile.
protocol AgentProfile {
    /// Stable id, persisted in chat snapshots ("claude", "kimi", "hs:<token>").
    var id: String { get }
    /// Human name — feeds every "Claude is working"-style UI string.
    var displayName: String { get }
    var capabilities: AgentCapabilities { get }

    /// Screen substrings that mean "actively generating". Empty for agents
    /// whose working state comes from the transcript tail instead.
    var workingMarkers: [String] { get }

    /// Seconds between the TUI taking the pane and its input line actually
    /// accepting a submit. Claude is ready almost immediately; Kimi's TUI
    /// draws early but swallows input for a few seconds (verified by PTY test).
    var inputReadyDelay: TimeInterval { get }

    /// Does this command string launch this agent — bare, with args, after a
    /// separator (`&&`/`;`), or as a full path?
    func matches(_ command: String) -> Bool

    /// Rewrite a launch so its session is identifiable. Claude appends a fresh
    /// `--session-id <uuid>` (returned as `plannedSessionId`); agents without a
    /// pre-seedable id return the command unchanged and discover post-launch.
    func augmentLaunch(_ command: String) -> (command: String, plannedSessionId: String?)

    /// The command that (re)launches this agent — resuming a previous session
    /// when `sessionId` is non-nil and the agent supports it.
    func launchCommand(resuming sessionId: String?, settings: AppSettings) -> String

    /// A transcript reader bound to this pane's cwd + launch.
    func makeReader(cwd: String, plannedSessionId: String?, launchedAt: Date) -> AgentTranscriptReader
}

/// Shared "does this command invoke <binary>" test — bare, with args, after a
/// separator, or as a full path. The same shape `TerminalSession.isClaudeCommand`
/// has always used.
enum AgentCommandMatcher {
    static func command(_ command: String, invokes binary: String) -> Bool {
        command.range(of: "(^|[ /&;])\(binary)($| )", options: .regularExpression) != nil
    }
}

// MARK: - Claude

/// The flagship profile. Behavior here is a straight move of what
/// `TerminalSession` hardcoded — commands and markers are byte-identical.
struct ClaudeAgentProfile: AgentProfile {
    let id = "claude"
    let displayName = "Claude"
    let capabilities = AgentCapabilities(
        modelPicker: true, effortPicker: true, permissionMenus: true,
        contextGauge: true, resumable: true, statusAndTip: true)

    /// Claude's on-screen working markers. Matched as PREFIX fragments — a
    /// narrow pane truncates the line (e.g. "esc to inter…"), so the full
    /// string often isn't on screen.
    let workingMarkers = [
        "esc to inter",     // "esc to interrupt" (poss. truncated)
        "esc to canc",      // "esc to cancel" (poss. truncated)
        "to interrupt",
        "ctrl+t to",
        "· interrupt",
    ]

    let inputReadyDelay: TimeInterval = 1.0

    func matches(_ command: String) -> Bool {
        AgentCommandMatcher.command(command, invokes: "claude")
    }

    /// Augment a `claude …` launch with a fresh `--session-id` so its transcript
    /// is identifiable, unless the command already selects a session.
    func augmentLaunch(_ command: String) -> (command: String, plannedSessionId: String?) {
        let selectors = ["--session-id", "--resume", "--continue", " -r ", " -c "]
        if selectors.contains(where: { command.contains($0) })
            || command.hasSuffix(" -r") || command.hasSuffix(" -c") { return (command, nil) }
        let uuid = UUID().uuidString.lowercased()
        return (command + " --session-id \(uuid)", uuid)
    }

    func launchCommand(resuming sessionId: String?, settings: AppSettings) -> String {
        // Respect a user-configured claude launch (extra flags) for fresh chats.
        let configured = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = matches(configured) ? configured : "claude --dangerously-skip-permissions"
        guard let sessionId else { return base }
        return "claude --dangerously-skip-permissions --resume \(sessionId)"
    }

    func makeReader(cwd: String, plannedSessionId: String?, launchedAt: Date) -> AgentTranscriptReader {
        ClaudeTranscriptReader(cwd: cwd, boundSessionId: plannedSessionId)
    }
}

// MARK: - Registry

/// Resolves a launch command (or a persisted id) to an agent profile.
/// Resolution order: built-ins first, then the handshake cache (agents learned
/// via the first-run introduction).
enum AgentRegistry {
    static let claude = ClaudeAgentProfile()
    static let kimi = KimiAgentProfile()
    private static var builtins: [AgentProfile] { [claude, kimi] }

    /// The profile whose launch matcher recognizes this command, if any.
    static func profile(forCommand command: String, settings: AppSettings) -> AgentProfile? {
        let cmd = command.lowercased()
        if let hit = builtins.first(where: { $0.matches(cmd) }) { return hit }
        if let learned = HandshakeAgentProfile.forCommand(cmd, settings: settings) { return learned }
        return nil
    }

    /// The profile for a persisted chat snapshot's agent id (restore path).
    static func profile(forId id: String, settings: AppSettings) -> AgentProfile? {
        if let hit = builtins.first(where: { $0.id == id }) { return hit }
        if let learned = HandshakeAgentProfile.forId(id, settings: settings) { return learned }
        return nil
    }
}
