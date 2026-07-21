import Foundation

/// The "service hatch": a one-click agent dev session opened *inside* IDEalize,
/// rooted in IDEalize's own source, so the app can be safely serviced from within
/// itself. This enum resolves the paths and builds the launch command; the tab
/// itself is created by `Workspace.openServiceHatch()`.
enum ServiceHatch {
    /// IDEalize's source repo — where the hatch session cd's to. Resolved from the
    /// running context: a dev `swift run` build's working directory, or a packaged
    /// `.app` sitting at `<repo>/dist/IDEalize.app`. Each candidate is validated as
    /// a real IDEalize checkout so a stray path never sends the session somewhere
    /// meaningless. If nothing resolves, returns nil and the hatch does not open.
    static func repoRoot() -> String? {
        let fm = FileManager.default
        func isRepo(_ path: String) -> Bool {
            fm.fileExists(atPath: path + "/Package.swift")
                && fm.fileExists(atPath: path + "/Sources/IDEalizeApp")
        }
        var candidates: [String] = []
        // Dev: `swift run` starts with the repo as the working directory.
        candidates.append(fm.currentDirectoryPath)
        // Packaged: Bundle.main is <repo>/dist/IDEalize.app → strip the app and dist.
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
    static func launchCommand() -> String {
        var cmd = AppSettings.shared.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        if cmd.isEmpty { cmd = "claude --dangerously-skip-permissions" }
        if let docs = vaultDocsDir() {
            cmd += " --add-dir \(quote(docs))"
        }
        cmd += " \(quote("/idealize-service-hatch"))"
        return cmd
    }

    /// Single-quote a shell argument (paths here can contain spaces, e.g. the
    /// "_Obsidian Vaults" segment).
    private static func quote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
