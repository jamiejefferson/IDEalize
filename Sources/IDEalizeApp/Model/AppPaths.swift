import Foundation

/// Where the app keeps its own files, and — critically — whether this is the dev
/// build so it stays out of the installed app's way.
///
/// The dev build already gets its own IPC socket dir (`IPC.socketPath`) and its
/// own preferences domain (via the `.dev` bundle id), so a developer can run a
/// test build alongside the app they use daily. Anything *else* the app writes
/// under Application Support has to make the same split by hand, or a dev run
/// quietly edits the real app's state. This is that one place.
///
/// Deliberately *not* covering `~/.claude`: `FlowSkillInstaller` installs the
/// slash commands there, and Claude Code only resolves `/project-agent` from
/// `~/.claude/commands/`, so redirecting it would break the very thing it
/// provisions. That sharing is a known hazard — see `FlowSkillInstaller`.
enum AppPaths {
    /// Whether this process is the dev build (`com.idealize.terminal.dev`).
    static var isDevBuild: Bool {
        Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true
    }

    /// `~/Library/Application Support/IDEalize` — or `IDEalize Dev` for the dev
    /// build, matching the socket dir so a test run never edits the installed
    /// app's files.
    static var supportDir: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/Application Support")
            .appendingPathComponent(isDevBuild ? "IDEalize Dev" : "IDEalize")
    }
}
