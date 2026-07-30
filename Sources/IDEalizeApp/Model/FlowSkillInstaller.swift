import Foundation

/// Provisions IDEalize's "companion" agent skill + commands into the user's
/// `~/.claude/` on launch, so any project the user opens can review and run (and
/// resume) Flows. Currently Claude-only: the flow commands are implemented as
/// Claude slash commands. Mirrors `ShellIntegration.install()` and `CLIInstaller`:
/// app machinery pushed into the user's environment, idempotently, on startup.
///
/// User scope is deliberate. The runner is *app behaviour*, so it should be
/// available everywhere — while a flow's `flow.json` stays project-scoped and
/// committable. Without this step a shipped app opening some other project would
/// find no `flow-run`/`flow-review` at all (they only live in this dev repo's
/// `.claude/`), so Flows simply wouldn't work for a fresh install.
///
/// The source of truth is `Resources/FlowSkills/` — copied into the packaged
/// app's `Contents/Resources/` by `scripts/build-app.sh`, and read straight from
/// the source tree in a `swift run` dev build (the same bundle-then-dev fallback
/// as `Branding`).
enum FlowSkillInstaller {
    /// Bump whenever the bundled skill/command text changes, so an app update
    /// re-installs the newer copy rather than leaving a stale one in place.
    /// v2: flow file moved to the global path (project-independent).
    /// v3: added `flow-improve` (Claude applies its review suggestions to the flow).
    /// v4: added `idealize-service-hatch` (self-service dev session guide).
    /// v5: added `/flows` (model-agnostic workflow coach for the Flows interview).
    /// v6: added `project-agent` (the coordinating chat for a project's chats).
    /// v7: project-agent guide delivered via system prompt; command slimmed (no visible skill dump).
    /// v8: project-agent gains `spawn` (delegate work to new chats) + "safe version" & "learning from the work" roles.
    /// v9: project-agent rewritten (v2 prompt): "one version of the truth" prime directive, two language registers, the project board, enforced chat rules, the path-to-live ladder.
    /// v10: project-agent names the chats it spawns (`idealize spawn --name`).
    /// v11: project-agent lands the work unprompted — one sign-off gate, then
    ///      combine, go live, confirm, and tidy the board/vault/skills.
    /// v12: added `lead-agent` (the fleet coordinator above the project agents);
    ///      project-agent gains "Reporting upward", ship/scout task shapes, and
    ///      self-serve combining (the one ask moves to go-live).
    static let version = 12

    /// The companion files: bundle-relative source → `~/.claude`-relative dest.
    /// Add-only, and only for files the app owns: every entry here is *overwritten*
    /// on each version bump, so anything the user may have edited themselves (their
    /// custom project-agent prompt, say) must never be listed — it would be silently
    /// replaced by the bundled copy on the next launch.
    private static let files: [(src: String, dest: String)] = [
        ("FlowSkills/skills/flow-run/SKILL.md",          "skills/flow-run/SKILL.md"),
        ("FlowSkills/skills/flows/SKILL.md",             "skills/flows/SKILL.md"),
        ("FlowSkills/commands/flow-run.md",              "commands/flow-run.md"),
        ("FlowSkills/commands/flow-review.md",           "commands/flow-review.md"),
        ("FlowSkills/commands/flow-improve.md",          "commands/flow-improve.md"),
        ("FlowSkills/commands/flows.md",                 "commands/flows.md"),
        ("FlowSkills/commands/idealize-service-hatch.md", "commands/idealize-service-hatch.md"),
        ("FlowSkills/commands/project-agent.md",         "commands/project-agent.md"),
        ("FlowSkills/commands/lead-agent.md",            "commands/lead-agent.md"),
    ]

    private static var claudeDir: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude")
    }

    /// The project agent's operating guide — the one provisioned file the *app*
    /// reads (via `--append-system-prompt`) rather than Claude Code.
    ///
    /// A dev build keeps its own copy outside `~/.claude` so it never rewrites the
    /// guide the installed app — and every Claude Code session on this machine — is
    /// reading. Without that, two builds compiled at different `version`s each saw
    /// the other's stamp as stale and reinstalled on every launch, so the file
    /// flipped between guides depending on which app started last and no review of
    /// a change to it could be trusted.
    static var projectAgentGuideURL: URL {
        AppPaths.isDevBuild
            ? AppPaths.supportDir.appendingPathComponent("project-agent-guide.md")
            : claudeDir.appendingPathComponent("skills/project-agent/SKILL.md")
    }

    /// The lead agent's operating guide — same app-read, dev-split arrangement
    /// as `projectAgentGuideURL`, for the same reasons.
    static var leadAgentGuideURL: URL {
        AppPaths.isDevBuild
            ? AppPaths.supportDir.appendingPathComponent("lead-agent-guide.md")
            : claudeDir.appendingPathComponent("skills/lead-agent/SKILL.md")
    }

    /// Whether `url` is a file this installer owns and will overwrite on the next
    /// version bump. The document panel uses this to refuse in-place edits: an edit
    /// here looks like it worked and is then silently reverted by an app update.
    ///
    /// Note the dev build's guide sits in the same directory as the user's *own*
    /// edited prompt (`ProjectAgent.customPromptURL`), which must stay editable —
    /// hence the exact-match on the guide rather than a prefix test on that folder.
    static func isProvisioned(_ url: URL) -> Bool {
        let path = url.standardizedFileURL.resolvingSymlinksInPath().path
        if path == projectAgentGuideURL.standardizedFileURL.resolvingSymlinksInPath().path
            || path == leadAgentGuideURL.standardizedFileURL.resolvingSymlinksInPath().path {
            return true
        }
        return path.hasPrefix(claudeDir.standardizedFileURL.path + "/")
    }

    /// Records the version last installed, so the common case (already current) is
    /// a single file read and no writes. Namespaced per build: a dev build and the
    /// installed app compile different `version`s, so a shared marker left them
    /// permanently disagreeing and reinstalling over each other.
    private static var versionMarker: URL {
        claudeDir.appendingPathComponent(
            AppPaths.isDevBuild ? ".idealize-flow-skills-version-dev"
                                : ".idealize-flow-skills-version")
    }

    /// Install (or refresh) the companion files when missing or out of date. Cheap
    /// and safe to call on every launch.
    @discardableResult
    static func install() -> Bool {
        if let stamp = try? String(contentsOf: versionMarker, encoding: .utf8),
           Int(stamp.trimmingCharacters(in: .whitespacesAndNewlines)) == version {
            return true   // already current — nothing to do
        }
        let fm = FileManager.default
        var ok = true
        // The guide's destination depends on the build, so it's paired up here
        // rather than living in the fixed `files` table.
        let work: [(src: String, dest: URL)] =
            files.map { ($0.src, claudeDir.appendingPathComponent($0.dest)) }
            + [("FlowSkills/skills/project-agent/SKILL.md", projectAgentGuideURL),
               ("FlowSkills/skills/lead-agent/SKILL.md",    leadAgentGuideURL)]
        for f in work {
            guard let src = sourceURL(for: f.src) else {
                NSLog("IDEalize: flow skill resource missing: \(f.src)"); ok = false; continue
            }
            do {
                try fm.createDirectory(at: f.dest.deletingLastPathComponent(),
                                       withIntermediateDirectories: true)
                try Data(contentsOf: src).write(to: f.dest)
            } catch {
                NSLog("IDEalize: failed to install \(f.dest.lastPathComponent): \(error)"); ok = false
            }
        }
        // Only stamp the version once every file landed, so a partial failure
        // retries on the next launch rather than being marked done.
        if ok { try? "\(version)".write(to: versionMarker, atomically: true, encoding: .utf8) }
        return ok
    }

    /// Locate a bundled resource, falling back to the source tree in dev — the
    /// packaged `.app` has it under `Contents/Resources/`; a `swift run` build
    /// reads it from `./Resources` (same approach as `Branding`).
    private static func sourceURL(for relPath: String) -> URL? {
        let fm = FileManager.default
        if let url = Bundle.main.resourceURL?.appendingPathComponent(relPath),
           fm.fileExists(atPath: url.path) {
            return url
        }
        let dev = URL(fileURLWithPath: fm.currentDirectoryPath)
            .appendingPathComponent("Resources").appendingPathComponent(relPath)
        return fm.fileExists(atPath: dev.path) ? dev : nil
    }
}
