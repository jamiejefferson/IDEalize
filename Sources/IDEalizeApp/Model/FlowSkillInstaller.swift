import Foundation

/// Provisions IDEalize's "companion" Claude skill + commands into the user's
/// `~/.claude/` on launch, so any project the user opens can review and run (and
/// resume) Flows. Mirrors `ShellIntegration.install()` and `CLIInstaller`: app
/// machinery pushed into the user's environment, idempotently, on startup.
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
    static let version = 1

    /// The companion files: bundle-relative source → `~/.claude`-relative dest.
    private static let files: [(src: String, dest: String)] = [
        ("FlowSkills/skills/flow-run/SKILL.md", "skills/flow-run/SKILL.md"),
        ("FlowSkills/commands/flow-run.md",     "commands/flow-run.md"),
        ("FlowSkills/commands/flow-review.md",  "commands/flow-review.md"),
    ]

    private static var claudeDir: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".claude")
    }

    /// Records the version last installed, so the common case (already current) is
    /// a single file read and no writes.
    private static var versionMarker: URL {
        claudeDir.appendingPathComponent(".idealize-flow-skills-version")
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
        for f in files {
            guard let src = sourceURL(for: f.src) else {
                NSLog("IDEalize: flow skill resource missing: \(f.src)"); ok = false; continue
            }
            let dest = claudeDir.appendingPathComponent(f.dest)
            do {
                try fm.createDirectory(at: dest.deletingLastPathComponent(),
                                       withIntermediateDirectories: true)
                try Data(contentsOf: src).write(to: dest)
            } catch {
                NSLog("IDEalize: failed to install \(f.dest): \(error)"); ok = false
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
