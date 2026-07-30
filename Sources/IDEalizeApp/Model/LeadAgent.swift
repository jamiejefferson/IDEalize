import Foundation

/// The "lead agent": one coordinating chat *above* the per-project agents,
/// running the user's configured agent with the `/lead-agent` companion guide.
/// It watches every project's coordinating agent (via the `idealize` CLI),
/// keeps a fleet board of what's moving everywhere, makes the calls the tiers
/// below can't, and brings the user only the decisions that are genuinely
/// theirs. It does no production work and never speaks in a worker chat.
/// This enum builds the launch command and owns the operating prompt on disk;
/// the tab itself is created by `Workspace.openLeadAgent()`. Modelled on
/// `ProjectAgent`.
enum LeadAgent {

    // MARK: - The fleet home

    /// The folder the lead agent's chat runs in. It has no project of its own,
    /// so it gets a dedicated home under Application Support: the rail then
    /// shows it as its own "Fleet" group (a project is just a folder-path
    /// grouping key), its `fleet-board.md` has somewhere real to live, and the
    /// dev build's lead stays out of the installed app's fleet via `AppPaths`.
    static var fleetHomeURL: URL {
        AppPaths.supportDir.appendingPathComponent("Fleet", isDirectory: true)
    }

    /// Create the fleet home if it's missing. Called just before launch, so the
    /// shell always has a real directory to start in.
    static func ensureFleetHome() {
        try? FileManager.default.createDirectory(
            at: fleetHomeURL, withIntermediateDirectories: true)
    }

    // MARK: - Launch command

    /// The command a lead-agent tab runs once its shell is ready: the configured
    /// agent, the leading guide as an invisible system prompt, and `/lead-agent`
    /// as the short opening turn. (Session-id binding and permission mode are
    /// appended later by `TerminalSession`.)
    static func launch() -> AgentLaunch {
        var cmd = baseCommand(AppSettings.shared.leadAgentLaunchCommand)
        if TerminalSession.isClaudeCommand(cmd) {
            cmd += " --append-system-prompt \"$(cat \(doubleQuoted(promptURL().path)))\""
        }
        cmd = ProjectAgent.applyingModel(AppSettings.shared.leadAgentModel, to: cmd)
        return AgentLaunch(command: cmd, openingTurn: "/lead-agent")
    }

    /// The agent command the lead starts from: its own override when set, else
    /// the global default, else the same sane fallback as a project agent — a
    /// lead dropped into a bare shell leads nothing.
    private static func baseCommand(_ override: String) -> String {
        let role = override.trimmingCharacters(in: .whitespacesAndNewlines)
        if !role.isEmpty { return role }
        let global = AppSettings.shared.defaultLaunchCommand
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return global.isEmpty ? "claude --dangerously-skip-permissions" : global
    }

    // MARK: - The operating prompt

    /// The guide IDEalize ships, written out by `FlowSkillInstaller` — read-only
    /// as far as the app's own UI is concerned (see `ProjectAgent.builtInPromptURL`).
    static var builtInPromptURL: URL {
        FlowSkillInstaller.leadAgentGuideURL
    }

    /// The user's own edited guide — outside `~/.claude` for the same reason as
    /// `ProjectAgent.customPromptURL`: the installer must never clobber edits.
    static var customPromptURL: URL {
        AppPaths.supportDir.appendingPathComponent("lead-agent-prompt.md")
    }

    /// Whether the user has a guide of their own in play; an empty file counts
    /// as no override.
    static var usesCustomPrompt: Bool {
        guard let text = try? String(contentsOf: customPromptURL, encoding: .utf8) else {
            return false
        }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The guide the lead actually launches with.
    static func promptURL() -> URL {
        usesCustomPrompt ? customPromptURL : builtInPromptURL
    }

    /// Start an editable copy from the built-in guide — same guard semantics as
    /// `ProjectAgent.seedCustomPrompt()`: an existing file always wins.
    @discardableResult
    static func seedCustomPrompt() -> URL? {
        let dest = customPromptURL
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
        guard let text = try? String(contentsOf: builtInPromptURL, encoding: .utf8) else {
            return nil
        }
        do {
            try FileManager.default.createDirectory(
                at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: dest, atomically: true, encoding: .utf8)
        } catch {
            NSLog("IDEalize: couldn't start an editable lead-agent prompt: \(error)")
            return nil
        }
        AppSettings.shared.leadAgentPromptBaseVersion = FlowSkillInstaller.version
        return dest
    }

    /// Drop the user's copy and go back to the built-in guide — same
    /// remove-then-verify semantics as `ProjectAgent.resetCustomPrompt()`.
    @discardableResult
    static func resetCustomPrompt() -> Bool {
        try? FileManager.default.removeItem(at: customPromptURL)
        guard !FileManager.default.fileExists(atPath: customPromptURL.path) else { return false }
        AppSettings.shared.leadAgentPromptBaseVersion = 0
        return true
    }

    /// The user's copy was taken from an older built-in guide — drives the
    /// stale-base notice in Preferences.
    static var customPromptIsBehind: Bool {
        usesCustomPrompt
            && AppSettings.shared.leadAgentPromptBaseVersion < FlowSkillInstaller.version
    }

    // MARK: - Helpers

    /// Double-quote a path for use inside the `"$(cat "…")"` substitution —
    /// same escaping as `ProjectAgent`.
    private static func doubleQuoted(_ s: String) -> String {
        var out = ""
        for ch in s {
            if ch == "\\" || ch == "\"" || ch == "$" || ch == "`" { out.append("\\") }
            out.append(ch)
        }
        return "\"" + out + "\""
    }
}
