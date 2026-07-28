import Foundation

/// The "project agent": a coordinating chat opened *inside* a project, running
/// the user's configured agent with the `/project-agent` companion guide as its
/// opening turn. It watches the project's other chats (via the `idealize` CLI),
/// notices when their work might collide, asks the user to make the call in
/// plain language, and relays decisions back to the affected chats. This enum
/// builds the launch command; the tab itself is created by
/// `Workspace.openProjectAgent()`. Modelled on `ServiceHatch`.
enum ProjectAgent {
    /// The command a project-agent tab runs once its shell is ready: the
    /// configured default agent with `/project-agent` loaded as the opening
    /// turn. (The session's own session id is appended later by
    /// `TerminalSession` when supported.)
    static func launchCommand() -> String {
        var cmd = AppSettings.shared.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        if cmd.isEmpty { cmd = "claude --dangerously-skip-permissions" }
        // Deliver the coordinating guide as an invisible system prompt (never
        // printed in the chat) rather than a visible skill invocation. The
        // `/project-agent` command then only carries the short opening turn.
        if TerminalSession.isClaudeCommand(cmd) {
            cmd += " --append-system-prompt \"$(cat \"$HOME/.claude/skills/project-agent/SKILL.md\")\""
        }
        cmd += " \(quote("/project-agent"))"
        return cmd
    }

    /// The command a *child* worker chat runs when the project agent spawns it:
    /// the user's configured default agent, optionally handed `initialPrompt` as
    /// its opening turn. The prompt is delivered as a trailing positional
    /// argument — the same way `launchCommand()` hands over `/project-agent`, and
    /// exactly how Claude Code (and similar CLIs) accept an initial prompt. A
    /// child is a *normal* member chat, not another coordinator: the user can
    /// open and review it like any other. Session-id binding and permission mode
    /// are appended later by `TerminalSession.augmentAgentLaunch`.
    static func childLaunchCommand(initialPrompt: String?) -> String {
        var cmd = AppSettings.shared.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        if cmd.isEmpty { cmd = "claude --dangerously-skip-permissions" }
        if let p = initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty {
            cmd += " " + quote(p)
        }
        return cmd
    }

    /// A path is worth coordinating when it's a real project folder — watching
    /// the home directory (or root) would both be meaningless and sweep up the
    /// whole tree. Mirrors the explorer's "no home fallback" rule.
    static func isCoordinatable(_ projectPath: String?) -> Bool {
        guard let p = projectPath, !p.isEmpty, p != "/" else { return false }
        return p != FileManager.default.homeDirectoryForCurrentUser.path
    }

    /// Single-quote a shell argument (paths here can contain spaces).
    private static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
