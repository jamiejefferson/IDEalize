import Foundation

/// Resolves the `idealize-cli` binary and exposes it under the user-facing name
/// `idealize` on a stable directory that gets prepended to spawned shells' PATH.
///
/// Why a shim: the app binary is `IDEalize` and the CLI is `idealize-cli`
/// (they cannot both be literally `idealize`/`IDEalize` because macOS is
/// case-insensitive). We create `~/Library/Application Support/IDEalize/bin/idealize`
/// pointing at whichever build of the CLI we found.
///
/// Ownership: the shim directory is SHARED — every chat in every running
/// instance has it on PATH — so only the app the user actually installed may
/// write to it. A dev build, a probe bundle, a release test build run out of
/// /tmp, or a `swift run` would otherwise repoint the shared `idealize` at its
/// own throwaway binary, breaking the CLI for every chat in the installed app
/// the moment that bundle is deleted. Non-installed builds get their own bin
/// directory instead, so they still have a working `idealize` in their chats.
enum CLIInstaller {
    /// The one shim directory the installed app owns and every chat gets on PATH.
    static let sharedBinDir = NSHomeDirectory() + "/Library/Application Support/IDEalize/bin"

    /// True when the running bundle is the installed app (`/Applications` or the
    /// per-user `~/Applications`). Location, not bundle id, is the test: a
    /// release build under test in /tmp carries the production bundle id and
    /// would still hijack the shared shim if we keyed off the id alone.
    static var isInstalledBuild: Bool {
        let path = Bundle.main.bundlePath
        return path.hasPrefix("/Applications/")
            || path.hasPrefix(NSHomeDirectory() + "/Applications/")
    }

    /// Where this build's shim lives. Installed app: the shared dir. Anything
    /// else: a private dir keyed to the bundle path, so two dev builds in two
    /// safe copies don't fight over one shim either.
    static var binDir: String {
        guard !isInstalledBuild else { return sharedBinDir }
        let key = String(format: "%08x", fnv1a(Bundle.main.bundlePath))
        return NSHomeDirectory() + "/Library/Application Support/IDEalize Dev/bin-\(key)"
    }

    static var shimPath: String { binDir + "/idealize" }

    /// FNV-1a, purely to turn a bundle path into a short stable directory name.
    private static func fnv1a(_ s: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for b in s.utf8 { h = (h ^ UInt32(b)) &* 16_777_619 }
        return h
    }

    /// Locate the built CLI binary across bundle and dev layouts.
    static func resolveCLIBinary() -> String? {
        let fm = FileManager.default
        var candidates: [String] = []

        // 1. Inside the .app bundle: Contents/Helpers/idealize-cli
        let bundlePath = Bundle.main.bundlePath
        candidates.append(bundlePath + "/Contents/Helpers/idealize-cli")
        // 2. Next to the executable (loose layout).
        if let exeDir = (Bundle.main.executablePath as NSString?)?.deletingLastPathComponent {
            candidates.append(exeDir + "/idealize-cli")
        }
        // 3. Dev: SwiftPM build directories relative to the working dir.
        let cwd = fm.currentDirectoryPath
        candidates.append(cwd + "/.build/release/idealize-cli")
        candidates.append(cwd + "/.build/debug/idealize-cli")

        return candidates.first { fm.fileExists(atPath: $0) }
    }

    /// Create/refresh the `idealize` shim symlink. Returns the bin directory to
    /// add to PATH, or nil if the CLI couldn't be found.
    @discardableResult
    static func installShim() -> String? {
        guard let cli = resolveCLIBinary() else { return nil }
        let fm = FileManager.default
        let binDir = self.binDir, shimPath = binDir + "/idealize"
        try? fm.createDirectory(atPath: binDir, withIntermediateDirectories: true)
        // Replace any stale shim.
        if let existing = try? fm.destinationOfSymbolicLink(atPath: shimPath), existing != cli {
            try? fm.removeItem(atPath: shimPath)
        } else if fm.fileExists(atPath: shimPath),
                  (try? fm.destinationOfSymbolicLink(atPath: shimPath)) == nil {
            try? fm.removeItem(atPath: shimPath)
        }
        if !fm.fileExists(atPath: shimPath) {
            try? fm.createSymbolicLink(atPath: shimPath, withDestinationPath: cli)
        }
        return fm.fileExists(atPath: shimPath) ? binDir : nil
    }
}
