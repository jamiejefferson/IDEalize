import Foundation

/// The "service hatch": a one-click agent dev session opened *inside* IDEalize,
/// rooted in IDEalize's own source, so the app can be safely serviced from within
/// itself. This enum resolves the paths and builds the launch command; the tab
/// itself is created by `Workspace.openServiceHatch()`.
enum ServiceHatch {
    /// Validate that a path is a real IDEalize source checkout, so a stray path
    /// never sends the session somewhere meaningless.
    static func isRepo(_ path: String) -> Bool {
        let fm = FileManager.default
        return fm.fileExists(atPath: path + "/Package.swift")
            && fm.fileExists(atPath: path + "/Sources/IDEalizeApp")
    }

    /// IDEalize's source repo — where the hatch session cd's to. Resolved, in order,
    /// from: the folder the user configured in Settings; a dev `swift run` build's
    /// working directory; or a packaged `.app` sitting at `<repo>/dist/IDEalize.app`.
    /// The configured path comes first because an installed app (in `/Applications`)
    /// has no path relationship to the source and can't infer it. Each candidate is
    /// validated as a real checkout. If nothing resolves, returns nil and the hatch
    /// does not open — the caller sends the user to Settings to point at the source.
    static func repoRoot() -> String? {
        let fm = FileManager.default
        var candidates: [String] = []
        // The user-configured source folder (set in Settings → Launch). Wins so an
        // installed app can find a checkout that lives anywhere on disk.
        let configured = AppSettings.shared.serviceHatchRepoPath
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !configured.isEmpty { candidates.append(configured) }
        // Dev: `swift run` starts with the repo as the working directory.
        candidates.append(fm.currentDirectoryPath)
        // Packaged in-place: Bundle.main is <repo>/dist/IDEalize.app → strip app + dist.
        let fromBundle = Bundle.main.bundleURL
            .deletingLastPathComponent()   // …/dist
            .deletingLastPathComponent()   // …/<repo>
        candidates.append(fromBundle.path)
        return candidates.first(where: isRepo)
    }

    /// The project's docs in the Obsidian vault — the source of truth for status
    /// and thinking. Handed to the agent as an in-scope directory so the hatch
    /// session can read and update `_index.md` without a permission gate.
    /// The vault location is per-developer, so no path is hardcoded here: until a
    /// general resolution exists this returns nil and the hatch launches without
    /// an `--add-dir`.
    static func vaultDocsDir() -> String? {
        nil
    }

    /// The command a hatch tab runs once its shell is ready: the configured default
    /// agent, the vault docs added as an in-scope directory, and the
    /// `/idealize-service-hatch` guide loaded as the opening turn. (The session's
    /// own session id is appended later by `TerminalSession` when supported.)
    static func launch() -> AgentLaunch {
        var cmd = AppSettings.shared.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        if cmd.isEmpty { cmd = "claude --dangerously-skip-permissions" }
        if let docs = vaultDocsDir() {
            cmd += " --add-dir \(quote(docs))"
        }
        return AgentLaunch(command: cmd, openingTurn: "/idealize-service-hatch")
    }

    /// Single-quote a shell argument (paths here can contain spaces, e.g. the
    /// "_Obsidian Vaults" segment).
    private static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
