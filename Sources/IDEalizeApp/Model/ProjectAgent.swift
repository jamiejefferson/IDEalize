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
    static func launch() -> AgentLaunch {
        var cmd = baseCommand(AppSettings.shared.projectAgentLaunchCommand)
        // Deliver the coordinating guide as an invisible system prompt (never
        // printed in the chat) rather than a visible skill invocation. The
        // `/project-agent` command then only carries the short opening turn.
        if TerminalSession.isClaudeCommand(cmd) {
            cmd += " --append-system-prompt \"$(cat \(doubleQuoted(promptURL().path)))\""
        }
        cmd = applyingModel(AppSettings.shared.projectAgentModel, to: cmd)
        return AgentLaunch(command: cmd, openingTurn: "/project-agent")
    }

    /// The command a *child* worker chat runs when the project agent spawns it:
    /// the user's configured default agent, optionally handed `initialPrompt` as
    /// its opening turn. The prompt is delivered as a trailing positional
    /// argument — the same way `launchCommand()` hands over `/project-agent`, and
    /// exactly how Claude Code (and similar CLIs) accept an initial prompt. A
    /// child is a *normal* member chat, not another coordinator: the user can
    /// open and review it like any other. Session-id binding and permission mode
    /// are appended later by `TerminalSession.augmentAgentLaunch`.
    static func childLaunch(initialPrompt: String?) -> AgentLaunch {
        // Children start from the *global* default agent, never the coordinator's
        // own override: only the model is role-specific, so picking a cheap
        // coordinator never quietly downgrades the chats doing the building.
        let cmd = applyingModel(AppSettings.shared.projectAgentChildModel,
                               to: baseCommand(""))
        // The brief stays out of the command string — it's the user's prose, and
        // rewriting a command containing it corrupted briefs (see `AgentLaunch`).
        let turn = initialPrompt?.trimmingCharacters(in: .whitespacesAndNewlines)
        return AgentLaunch(command: cmd,
                           openingTurn: (turn?.isEmpty == false) ? turn : nil)
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

    // MARK: - Naming a spawned chat

    /// The longest a derived tab name gets. The session rail lists chats in a
    /// narrow column, so a name that doesn't fit is worse than a shorter one.
    private static let nameLimit = 32

    /// A short tab label for a chat spawned with `task`, used when the coordinator
    /// didn't pass one of its own.
    ///
    /// Reads only the first line, and within it only the first sentence: the
    /// coordinating guide tells the agent to brief a chat with the route to live,
    /// the definition of done and any traps it should know, so a task is usually a
    /// paragraph or more. Naively taking the opening words of that gives labels
    /// like "You are working on the" — the head of a *sentence* is a much better
    /// guess at the head of the *job*. Returns nil when nothing usable survives,
    /// which leaves the tab on its normal folder-derived name rather than
    /// replacing it with something worse.
    static func chatName(fromTask task: String) -> String? {
        guard var s = task.split(whereSeparator: \.isNewline)
                .map({ $0.trimmingCharacters(in: .whitespaces) })
                .first(where: { !$0.isEmpty })
        else { return nil }
        // Briefs often open as a heading or list item; that decoration isn't part
        // of the name.
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "#*_-–—•>·. \t"))
        // Cut at the first sentence end, but only if what's left still says
        // something — "Fix it." shouldn't become "Fix it" via a 6-character stub.
        if let stop = s.rangeOfCharacter(from: CharacterSet(charactersIn: ".!?;:")) {
            let head = String(s[s.startIndex..<stop.lowerBound])
                .trimmingCharacters(in: .whitespaces)
            if head.count >= 12 { s = head }
        }
        guard !s.isEmpty else { return nil }
        if s.count > nameLimit {
            var cut = String(s.prefix(nameLimit))
            // Prefer a word boundary, unless that leaves barely anything.
            if let space = cut.lastIndex(of: " "),
               cut.distance(from: cut.startIndex, to: space) >= 14 {
                cut = String(cut[cut.startIndex..<space])
            }
            s = cut.trimmingCharacters(in: .whitespaces) + "…"
        }
        // Sentence-case a lowercase opener — unless the next character is a
        // capital, which means the word is deliberately styled that way and
        // "iOS share sheet" would otherwise become "IOS share sheet".
        if let first = s.first, first.isLowercase,
           s.dropFirst().first?.isUppercase != true {
            s = first.uppercased() + s.dropFirst()
        }
        return s
    }

    // MARK: - The operating prompt

    /// The guide IDEalize ships, written out by `FlowSkillInstaller` — which owns
    /// where it lands, since that differs between the installed app and a dev
    /// build. Overwritten on every version bump, so it is strictly read-only as far
    /// as the app's own UI is concerned.
    static var builtInPromptURL: URL {
        FlowSkillInstaller.projectAgentGuideURL
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
        // Guard on the file *existing*, not on it being readable as UTF-8:
        // `usesCustomPrompt` is false for a copy that was re-saved as UTF-16 or
        // has one bad byte, and seeding over that would destroy real edits with
        // no warning. Anything already there wins; the caller opens it as-is.
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
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

    /// Drop the user's copy and go back to the built-in guide. Returns false when
    /// the copy is still there afterwards, so the caller can say so rather than
    /// reporting a reset that didn't happen. Only clears the version stamp once the
    /// file is genuinely gone — zeroing it while the copy survives would leave
    /// `customPromptIsBehind` permanently claiming the copy is up to date.
    @discardableResult
    static func resetCustomPrompt() -> Bool {
        try? FileManager.default.removeItem(at: customPromptURL)
        guard !FileManager.default.fileExists(atPath: customPromptURL.path) else { return false }
        AppSettings.shared.projectAgentPromptBaseVersion = 0
        return true
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
    /// whole tree. Mirrors the explorer's "no home fallback" rule. The lead
    /// agent's Fleet home is excluded too: it isn't a project, so it must never
    /// grow its own project agent or have worker chats spawned into it.
    static func isCoordinatable(_ projectPath: String?) -> Bool {
        guard let p = projectPath, !p.isEmpty, p != "/" else { return false }
        guard p != LeadAgent.fleetHomeURL.path else { return false }
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
