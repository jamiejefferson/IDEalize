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
        cmd += " \(quote("/project-agent"))"
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
