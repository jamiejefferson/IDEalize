import Foundation

/// Resolves the `idealize-cli` binary and exposes it under the user-facing name
/// `idealize` on a stable directory that gets prepended to spawned shells' PATH.
///
/// Why a shim: the app binary is `IDEalize` and the CLI is `idealize-cli`
/// (they cannot both be literally `idealize`/`IDEalize` because macOS is
/// case-insensitive). We create `~/Library/Application Support/IDEalize/bin/idealize`
/// pointing at whichever build of the CLI we found.
enum CLIInstaller {
    static let binDir = NSHomeDirectory() + "/Library/Application Support/IDEalize/bin"
    static let shimPath = binDir + "/idealize"

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
