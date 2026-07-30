import Foundation

/// The "project agent": a coordinating chat opened *inside* a project, running
/// the user's configured agent with the `/project-agent` companion guide as its
/// opening turn. It watches the project's other chats (via the `idealize` CLI),
/// notices when their work might collide, asks the user to make the call in
/// plain language, and relays decisions back to the affected chats. This enum
/// builds the launch command and owns the operating prompt on disk; the tab
/// itself is created by `Workspace.openProjectAgent()`. Modelled on `ServiceHatch`.
enum ProjectAgent {

    // MARK: - Launch commands

    /// The command a project-agent tab runs once its shell is ready: the
    /// configured agent, the coordinating guide as an invisible system prompt, and
    /// `/project-agent` as the short opening turn. (The session's own session id
    /// and permission mode are appended later by `TerminalSession`.)
    static func launchCommand() -> String {
        var cmd = baseCommand(AppSettings.shared.projectAgentLaunchCommand)
        // Deliver the coordinating guide as an invisible system prompt (never
        // printed in the chat) rather than a visible skill invocation. The
        // `/project-agent` command then only carries the short opening turn.
        if TerminalSession.isClaudeCommand(cmd) {
            cmd += " --append-system-prompt \"$(cat \(doubleQuoted(promptURL().path)))\""
        }
        cmd = applyingModel(AppSettings.shared.projectAgentModel, to: cmd)
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
        // Children start from the *global* default agent, never the coordinator's
        // own override: only the model is role-specific, so picking a cheap
        // coordinator never quietly downgrades the chats doing the building.
        var cmd = applyingModel(AppSettings.shared.projectAgentChildModel,
                                to: baseCommand(""))
        if let p = initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty {
            cmd += " " + quote(p)
        }
        return cmd
    }

    /// The agent command a coordinator (or its children) starts from: the
    /// role-specific override when one is set, else the global default, else a
    /// sane fallback so a coordinator is never dropped into a bare shell.
    private static func baseCommand(_ override: String) -> String {
        let role = override.trimmingCharacters(in: .whitespacesAndNewlines)
        if !role.isEmpty { return role }
        let global = AppSettings.shared.defaultLaunchCommand
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return global.isEmpty ? "claude --dangerously-skip-permissions" : global
    }

    /// Append `--model <model>` to a Claude launch. A no-op when no model is
    /// chosen, when the command isn't Claude (a `kimi` command must not be handed
    /// a Claude flag), or when the command already selects one — mirroring the way
    /// `TerminalSession.augmentAgentLaunch` leaves an explicit `--session-id`
    /// alone rather than adding a second, conflicting copy.
    static func applyingModel(_ model: String, to command: String) -> String {
        let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !m.isEmpty,
              TerminalSession.isClaudeCommand(command),
              !command.contains("--model") else { return command }
        return command + " --model \(quote(m))"
    }

    // MARK: - The operating prompt

    /// The guide IDEalize ships, installed into `~/.claude` by
    /// `FlowSkillInstaller`. Overwritten on every version bump, so it is strictly
    /// read-only as far as the app's own UI is concerned.
    static var builtInPromptURL: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".claude/skills/project-agent/SKILL.md")
    }

    /// The user's own edited guide. Deliberately kept *outside* `~/.claude` so
    /// `FlowSkillInstaller` cannot reach it: `install()` rewrites every path in its
    /// `files` list on a version bump, which would silently destroy edits weeks
    /// after they were made. Same home as `flow.json` and the saved flows — and
    /// via `AppPaths`, the dev build gets its own copy rather than editing the
    /// installed app's prompt out from under it.
    static var customPromptURL: URL {
        AppPaths.supportDir.appendingPathComponent("project-agent-prompt.md")
    }

    /// Whether the user has a guide of their own in play. An empty file counts as
    /// no override, so emptying the editor falls back to the built-in rather than
    /// launching a coordinator with no guide at all.
    static var usesCustomPrompt: Bool {
        guard let text = try? String(contentsOf: customPromptURL, encoding: .utf8) else {
            return false
        }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The guide a coordinator actually launches with: the user's when they have
    /// one, else the built-in.
    static func promptURL() -> URL {
        usesCustomPrompt ? customPromptURL : builtInPromptURL
    }

    /// Start an editable copy from the built-in guide, stamping the installer
    /// version it came from so we can later tell the user their copy has drifted
    /// behind a newer built-in. Never overwrites an existing copy. Returns nil
    /// when the built-in can't be read (the installer hasn't run yet).
    @discardableResult
    static func seedCustomPrompt() -> URL? {
        let dest = customPromptURL
        if usesCustomPrompt { return dest }   // already editing — never clobber
        guard let text = try? String(contentsOf: builtInPromptURL, encoding: .utf8) else {
            return nil
        }
        do {
            try FileManager.default.createDirectory(
                at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: dest, atomically: true, encoding: .utf8)
        } catch {
            NSLog("IDEalize: couldn't start an editable project-agent prompt: \(error)")
            return nil
        }
        AppSettings.shared.projectAgentPromptBaseVersion = FlowSkillInstaller.version
        return dest
    }

    /// Drop the user's copy and go back to the built-in guide.
    static func resetCustomPrompt() {
        try? FileManager.default.removeItem(at: customPromptURL)
        AppSettings.shared.projectAgentPromptBaseVersion = 0
    }

    /// The user is editing a copy taken from an older built-in guide: their edits
    /// are intact, but they're missing whatever changed since. Drives the
    /// stale-base notice in Preferences — the honest alternative to silently
    /// overwriting their work on an app update.
    static var customPromptIsBehind: Bool {
        usesCustomPrompt
            && AppSettings.shared.projectAgentPromptBaseVersion < FlowSkillInstaller.version
    }

    // MARK: - Helpers

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

    /// Double-quote a path for use *inside* the `"$(cat "…")"` substitution, where
    /// single quotes wouldn't nest. `$` and a backtick are escaped as well as `"`
    /// and `\`, so a home directory containing one can't be expanded by the shell.
    private static func doubleQuoted(_ s: String) -> String {
        var out = ""
        for ch in s {
            if ch == "\\" || ch == "\"" || ch == "$" || ch == "`" { out.append("\\") }
            out.append(ch)
        }
        return "\"" + out + "\""
    }
}
