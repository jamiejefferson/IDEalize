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

    /// A safe-copy worktree or an archived backup satisfies `isRepo` just as well as
    /// the live checkout does, so discovery has to rule them out explicitly — adopting
    /// one as "the source" would send the hatch to edit a throwaway copy.
    private static let excludedPathFragments = [
        "/.claude/worktrees/", "/safe-copy", "/safe-copies/",
        "/IDEalize Backups/", "/.Trash/", "/dist/",
    ]

    /// A checkout we'd be willing to service. Beyond the `isRepo` markers this rules
    /// out linked git worktrees — a worktree stores `.git` as a *file* pointing at its
    /// parent, where a real clone has a `.git` directory. That one test catches every
    /// worktree scheme at once (IDEalize's own safe copies, Conductor workspaces, bare
    /// `git worktree add`) without needing to know each tool's folder layout.
    static func isPlausibleSource(_ path: String) -> Bool {
        guard isRepo(path) else { return false }
        guard !excludedPathFragments.contains(where: { path.contains($0) }) else { return false }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path + "/.git", isDirectory: &isDir) else {
            return true   // not a git checkout at all; the markers still make it a source
        }
        return isDir.boolValue
    }

    /// Whether this checkout's `origin` names IDEalize. The strong signal that a
    /// folder is *the* source rather than a copy of it — an offline backup usually
    /// has no remote at all.
    static func hasIDEalizeOrigin(_ path: String) -> Bool {
        run("/usr/bin/git", ["-C", path, "remote", "get-url", "origin"], timeout: 1.0)
            .lowercased().contains("idealize")
    }

    /// IDEalize's source repo — where the hatch session cd's to. Resolved, in order,
    /// from: the folder the user configured in Settings; a dev `swift run` build's
    /// working directory; a packaged `.app` sitting at `<repo>/dist/IDEalize.app`; or,
    /// failing all of those, whatever `discover()` last found and stored.
    /// Each candidate is validated as a real checkout. If nothing resolves, returns
    /// nil and the hatch does not open — the caller sends the user to Settings.
    ///
    /// This stays synchronous and cheap: no searching happens here, so the wrench
    /// button never blocks. The searching is `discover()`, run in the background at
    /// startup, which writes its answer into the configured path checked first.
    static func repoRoot() -> String? {
        let fm = FileManager.default
        var candidates: [String] = []
        // The user-configured source folder (set in Settings → Launch, or adopted by
        // `discoverInBackground()`). Wins so an installed app can find a checkout that
        // lives anywhere on disk.
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

    // MARK: - Finding the source by itself

    /// Every checkout we can find on this machine, best first. Two passes, because
    /// neither alone is reliable: Spotlight finds a checkout wherever it lives but
    /// returns nothing when indexing is off or the volume isn't indexed; the folder
    /// scan always works but only looks where developers usually keep code.
    ///
    /// Ranking prefers a checkout whose `origin` names IDEalize, then the most
    /// recently modified — so the live checkout beats a stale clone.
    static func discover() -> [String] {
        var seen = Set<String>()
        var found: [String] = []
        for path in spotlightCandidates() + scanCandidates() where !seen.contains(path) {
            seen.insert(path)
            if isPlausibleSource(path) { found.append(path) }
        }
        return found.sorted { rank($0) > rank($1) }
    }

    /// Ask Spotlight for the checkout's most distinctive folder name, then confirm
    /// each hit's grandparent is a real checkout (`…/<repo>/Sources/IDEalizeApp`).
    private static func spotlightCandidates() -> [String] {
        // `kMDItemFSName` matches the folder itself; the content-type clause keeps
        // files of the same name out of the result.
        let query = "kMDItemFSName == 'IDEalizeApp' && kMDItemContentType == 'public.folder'"
        return run("/usr/bin/mdfind", ["-0", query], timeout: 2.0)
            .split(separator: "\0")
            .map(String.init)
            .map { ($0 as NSString).deletingLastPathComponent }   // …/<repo>/Sources
            .map { ($0 as NSString).deletingLastPathComponent }   // …/<repo>
    }

    /// Where developers actually keep code. Depth-limited and skips the folders that
    /// make a home-directory walk expensive, so this stays a fraction of a second.
    private static func scanCandidates() -> [String] {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        let roots = ["Documents", "Developer", "Projects", "Code", "src", "git", "Desktop"]
            .map { home.appendingPathComponent($0) } + [home]
        let skip: Set<String> = ["Library", "node_modules", ".build", ".git", "Applications"]

        var found: [String] = []
        for root in roots {
            guard let walk = fm.enumerator(at: root,
                                           includingPropertiesForKeys: [.isDirectoryKey],
                                           options: [.skipsHiddenFiles, .skipsPackageDescendants])
            else { continue }
            while let url = walk.nextObject() as? URL {
                // Depth is counted from the root we started at; 3 is deep enough for
                // `~/Documents/_AppDev/IDEalize` without walking whole trees.
                if walk.level > 3 || skip.contains(url.lastPathComponent) {
                    walk.skipDescendants()
                    continue
                }
                if isRepo(url.path) {
                    found.append(url.path)
                    walk.skipDescendants()   // nothing useful nested inside a checkout
                }
            }
        }
        return found
    }

    /// Higher is better. A matching git remote is the strong signal; recency breaks
    /// ties between two real checkouts.
    private static func rank(_ path: String) -> Double {
        var score = 0.0
        if hasIDEalizeOrigin(path) { score += 1_000_000 }
        if let m = try? FileManager.default
            .attributesOfItem(atPath: path + "/Package.swift")[.modificationDate] as? Date {
            score += m.timeIntervalSince1970 / 1_000_000   // recency, well below the remote bonus
        }
        return score
    }

    /// Find the source in the background and adopt it, so the wrench button just works
    /// on an installed build that was never pointed at a checkout. Only runs when
    /// nothing is configured and the cheap candidates have already failed.
    ///
    /// Adopts only when exactly one candidate carries an IDEalize `origin`. That's the
    /// difference between the checkout you work in and a folder that merely looks like
    /// one (an offline backup has the same files but no remote). Anything less
    /// clear-cut is left to the user in Settings rather than guessed at silently.
    static func discoverInBackground() {
        guard AppSettings.shared.serviceHatchRepoPath
            .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              repoRoot() == nil else { return }
        DispatchQueue.global(qos: .utility).async {
            let confident = discover().filter(hasIDEalizeOrigin)
            guard confident.count == 1, let only = confident.first else { return }
            DispatchQueue.main.async {
                // Re-check: the user may have chosen a folder while we were looking.
                guard AppSettings.shared.serviceHatchRepoPath
                    .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                AppSettings.shared.serviceHatchRepoPath = only
            }
        }
    }

    /// Run a tool and return its stdout, giving up after `timeout` so a wedged
    /// Spotlight or git can't hold the discovery thread open.
    private static func run(_ launchPath: String, _ args: [String], timeout: TimeInterval) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: launchPath)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return "" }
        // Drain concurrently: a tool that outfills the pipe buffer blocks on write and
        // would never exit if we only read after waiting for it.
        let lock = NSLock()
        var out = Data()
        let drained = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async {
            let d = (try? pipe.fileHandleForReading.readToEnd()) ?? Data()
            lock.lock(); out = d; lock.unlock()
            drained.signal()
        }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning, Date() < deadline { usleep(20_000) }
        if p.isRunning { p.terminate() }
        guard drained.wait(timeout: .now() + 1.0) == .success else { return "" }
        lock.lock(); defer { lock.unlock() }
        return String(data: out, encoding: .utf8) ?? ""
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
