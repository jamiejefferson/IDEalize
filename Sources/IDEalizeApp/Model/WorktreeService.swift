import Foundation
import IDEalizeCore

/// Result of running a subprocess: exit status and captured output.
struct ProcResult {
    let status: Int32
    let stdout: String
    let stderr: String
}

/// Minimal synchronous subprocess runner. The app has no process-spawning
/// machinery outside the terminal itself, so `WorktreeService` needs this small
/// helper to shell out to `git`. It drains stdout/stderr on background queues so
/// a large output can't fill a pipe buffer and deadlock the child, and bounds the
/// wait with a timeout so a hung command can't wedge the caller.
enum Subprocess {
    static func run(_ executable: String,
                    _ args: [String],
                    cwd: String? = nil,
                    extraEnv: [String: String] = [:],
                    timeout: TimeInterval = 60) -> ProcResult? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = args
        if let cwd { proc.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        if !extraEnv.isEmpty {
            var env = ProcessInfo.processInfo.environment
            for (k, v) in extraEnv { env[k] = v }
            proc.environment = env
        }
        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        do { try proc.run() } catch { return nil }

        // Read both pipes to EOF concurrently — the classic full-pipe-deadlock
        // guard (a child blocked writing stderr while we wait on stdout).
        var outData = Data()
        var errData = Data()
        let group = DispatchGroup()
        let readQueue = DispatchQueue(label: "com.idealize.subprocess.read", attributes: .concurrent)
        group.enter()
        readQueue.async { outData = outPipe.fileHandleForReading.readDataToEndOfFile(); group.leave() }
        group.enter()
        readQueue.async { errData = errPipe.fileHandleForReading.readDataToEndOfFile(); group.leave() }

        // Wait for exit on a background thread so the timeout can bound it.
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { proc.waitUntilExit(); done.signal() }
        if done.wait(timeout: .now() + timeout) == .timedOut {
            proc.terminate()
            done.wait()   // reap the terminated process before reading its status
        }
        group.wait()      // both pipes drained
        return ProcResult(status: proc.terminationStatus,
                          stdout: String(decoding: outData, as: UTF8.self),
                          stderr: String(decoding: errData, as: UTF8.self))
    }
}

/// Creates and manages a chat's isolated "safe copy". In engineering terms a
/// safe copy is a git worktree on its own branch off the project's current
/// commit, so parallel chats can work without touching each other's files. Every
/// git term stays inside this file: nothing here returns a user-facing string,
/// honouring the V2 "translate, never expose" rule.
///
/// Worktrees live beside the app's other state (Application Support), never
/// inside the user's project folder, so a safe copy never shows up as stray
/// files in the project. Closing a chat never deletes its copy (see
/// `Workspace.closeSession`): work is only ever discarded by an explicit
/// `remove`, which no Stage-1 path calls.
enum WorktreeService {
    /// A safe copy: its directory, branch, and the commit it was taken from.
    struct Copy: Equatable {
        var path: String
        var branch: String
        var base: String
    }

    /// Where safe-copy worktrees live — outside any project tree.
    static var baseDir: String {
        NSHomeDirectory() + "/Library/Application Support/IDEalize/safe-copies"
    }

    /// Whether `dir` sits inside a git repository that has at least one commit —
    /// the only case where a safe copy can be taken. When false, the caller
    /// falls back to sharing the project folder (ordinary behaviour).
    static func canIsolate(_ dir: String) -> Bool {
        headCommit(of: dir) != nil
    }

    /// Create a fresh safe copy off `projectDir`'s current commit. Returns its
    /// directory, branch and base commit, or nil if the folder can't support one
    /// (not a git repo, no commits, or git failed). Never modifies the user's
    /// current files: a worktree is a brand-new directory on a brand-new branch;
    /// the user's uncommitted changes stay put in the original folder.
    @discardableResult
    static func create(from projectDir: String, label: String? = nil) -> Copy? {
        guard let base = headCommit(of: projectDir) else { return nil }
        try? FileManager.default.createDirectory(atPath: baseDir, withIntermediateDirectories: true)
        let token = String(UUID().uuidString.prefix(8)).lowercased()
        let slug = slugify(label)
        let leaf = slug.isEmpty ? "copy-\(token)" : "\(slug)-\(token)"
        let path = baseDir + "/" + leaf
        let branch = "idealize/safe-copy/\(leaf)"
        guard let r = git(["-C", projectDir, "worktree", "add", "-b", branch, path, base]),
              r.status == 0 else { return nil }
        return Copy(path: path, branch: branch, base: base)
    }

    /// The safe copies git currently knows about for `projectDir` (its own
    /// worktrees living under `baseDir`; the project's main tree is excluded).
    static func list(for projectDir: String) -> [Copy] {
        guard let r = git(["-C", projectDir, "worktree", "list", "--porcelain"]),
              r.status == 0 else { return [] }
        var copies: [Copy] = []
        var path: String?
        var branch: String?
        func flush() {
            if let p = path, p.hasPrefix(baseDir) {
                copies.append(Copy(path: p, branch: branch ?? "", base: ""))
            }
            path = nil
            branch = nil
        }
        for raw in r.stdout.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if line.hasPrefix("worktree ") {
                flush()
                path = String(line.dropFirst("worktree ".count))
            } else if line.hasPrefix("branch ") {
                branch = String(line.dropFirst("branch ".count))
            } else if line.isEmpty {
                flush()
            }
        }
        flush()
        return copies
    }

    /// Drop git's record of any safe copies whose directory has been removed.
    /// Never deletes a live worktree or a branch, so it is always safe to run.
    static func prune(_ projectDir: String) {
        _ = git(["-C", projectDir, "worktree", "prune"])
    }

    /// Deliberately discard a safe copy: remove its worktree directory and delete
    /// its branch. NOT called when a chat closes — only when the user or the agent
    /// explicitly chooses to throw the copy away (wired to a reviewed action in a
    /// later stage). Returns whether it fully succeeded.
    @discardableResult
    static func remove(_ copy: Copy, from projectDir: String) -> Bool {
        let removed = git(["-C", projectDir, "worktree", "remove", "--force", copy.path])
        guard removed?.status == 0 else { return false }
        guard !copy.branch.isEmpty else { return true }
        let deleted = git(["-C", projectDir, "branch", "-D", branchName(copy.branch)])
        return deleted?.status == 0
    }

    // MARK: - F2: read (diff / survey inputs)

    /// What `worktree` has changed versus `base` (its safe copy's base commit, or
    /// a ref like `origin/main` for a shared tree). Captures committed, staged,
    /// unstaged *and* untracked-new files, so an agent that never commits its work
    /// is still fully accounted for. Returns nil only when the folder isn't a git
    /// repo. If `base` doesn't resolve, falls back to `HEAD` (uncommitted changes)
    /// rather than failing.
    static func diff(worktree: String, base: String) -> IPCDiff? {
        guard headCommit(of: worktree) != nil else { return nil }
        let branch = git(["-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"])?
            .stdout.trimmingCharacters(in: .whitespacesAndNewlines) ?? "?"
        let effectiveBase = revExists(worktree, base) ? base : "HEAD"
        let ahead = countRevs(worktree, "\(effectiveBase)..HEAD")
        let behind = countRevs(worktree, "HEAD..\(effectiveBase)")
        var files: [IPCDiffFile] = []
        // Tracked changes (committed + staged + unstaged) vs base.
        if let r = git(["-C", worktree, "diff", "--numstat", effectiveBase]), r.status == 0 {
            for raw in r.stdout.split(separator: "\n") {
                let cols = raw.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
                guard cols.count == 3 else { continue }
                let added = Int(cols[0])   // "-" for binary files → nil
                let deleted = Int(cols[1])
                files.append(IPCDiffFile(path: cols[2], added: added, deleted: deleted,
                                         change: added == nil ? "binary" : "changed"))
            }
        }
        // New files not yet part of any commit.
        if let r = git(["-C", worktree, "ls-files", "--others", "--exclude-standard"]), r.status == 0 {
            for raw in r.stdout.split(separator: "\n") where !raw.isEmpty {
                files.append(IPCDiffFile(path: String(raw), added: nil, deleted: nil, change: "new"))
            }
        }
        let changed = files.filter { $0.change != "new" }.count
        let created = files.filter { $0.change == "new" }.count
        var parts: [String] = []
        if changed > 0 { parts.append("\(changed) file\(changed == 1 ? "" : "s") changed") }
        if created > 0 { parts.append("\(created) new file\(created == 1 ? "" : "s")") }
        let summary = parts.isEmpty ? "No changes yet." : parts.joined(separator: ", ") + "."
        return IPCDiff(branch: branch, base: effectiveBase, ahead: ahead, behind: behind,
                       files: files, summary: summary)
    }

    /// Whether `dir` has no uncommitted changes — a precondition for combining
    /// into it (never merge into a folder with unsaved work).
    static func isClean(_ dir: String) -> Bool {
        guard let r = git(["-C", dir, "status", "--porcelain"]), r.status == 0 else { return false }
        return r.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - F2: verify

    /// Run the folder's build/check and report honestly. Detects a known check
    /// (`Package.swift` → `swift build`); when there's none, returns `ran: false`
    /// and says so rather than faking a pass. Heavy: callers must run this OFF the
    /// main thread.
    static func verify(_ dir: String, check: String? = nil) -> IPCVerify {
        // An attached check wins over autodetect: the caller (a coordinator, at
        // spawn time or per-run) decided what proves this piece of work done, and
        // the executed result — not the chat's claim — is the proof. The command
        // only ever arrives via IPC (`spawn --verify` / `verify --check`); this
        // code never invents one. 15-minute budget: custom checks are usually a
        // test script, not a cold build.
        if let check = check?.trimmingCharacters(in: .whitespacesAndNewlines), !check.isEmpty {
            let r = Subprocess.run("/bin/sh", ["-c", check], cwd: dir,
                                   extraEnv: ["GIT_TERMINAL_PROMPT": "0"], timeout: 900)
            let passed = (r?.status == 0)
            let combined = (r?.stdout ?? "") + "\n" + (r?.stderr ?? "")
            return IPCVerify(ran: true, passed: passed, check: check,
                             tail: tailLines(combined, 40),
                             summary: passed ? "The check passed."
                                             : "The check didn't pass — there are problems to sort out.")
        }
        let fm = FileManager.default
        if fm.fileExists(atPath: dir + "/Package.swift") {
            let r = Subprocess.run("/usr/bin/env", ["swift", "build"], cwd: dir,
                                   extraEnv: ["GIT_TERMINAL_PROMPT": "0"], timeout: 1800)
            let passed = (r?.status == 0)
            let combined = (r?.stdout ?? "") + "\n" + (r?.stderr ?? "")
            return IPCVerify(ran: true, passed: passed, check: "build",
                             tail: tailLines(combined, 40),
                             summary: passed ? "It builds cleanly."
                                             : "It doesn't build yet — there are errors to sort out.")
        }
        return IPCVerify(ran: false, passed: nil, check: "none", tail: "",
                         summary: "There's no automatic check set up for this folder, so I can't confirm "
                                + "on my own that it works — best to open it and try it.")
    }

    // MARK: - F2: combine (staged, reversible)

    /// Result of a trial merge that changes nothing on disk.
    enum TrialResult { case clean; case conflicts([String]); case unknown }

    /// Ask git whether `incomingRef` would merge cleanly into `targetRef` — a dry
    /// run that never touches the working tree (`merge-tree --write-tree`). On old
    /// git without that flag it returns `.unknown`; the real safety net is
    /// `merge`, which aborts on conflict.
    static func trialMerge(into targetRef: String, incoming incomingRef: String, in repoDir: String) -> TrialResult {
        guard let r = git(["-C", repoDir, "merge-tree", "--write-tree", "--name-only", targetRef, incomingRef]) else {
            return .unknown
        }
        if r.status == 0 { return .clean }
        if r.status == 1 {
            // First line is the resulting tree's id; the rest are conflicted paths.
            let lines = r.stdout.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            let paths = Array(lines.dropFirst()).filter { !$0.isEmpty }
            return .conflicts(paths)
        }
        return .unknown
    }

    /// Snapshot everything in `worktree` into a commit on its own branch, so the
    /// chat's work becomes a combinable checkpoint. Safe and recoverable: it only
    /// records the copy's *own* isolated history and never touches anything else.
    /// A no-op (returns true) when there's nothing to snapshot.
    @discardableResult
    static func snapshot(worktree: String, message: String) -> Bool {
        _ = git(["-C", worktree, "add", "-A"])
        _ = git(["-C", worktree,
                 "-c", "user.email=agent@idealize.local", "-c", "user.name=IDEalize",
                 "commit", "-m", message])
        return true
    }

    /// Outcome of a real combine attempt. On `.conflict` the target was restored
    /// to exactly where it started (nothing combined); `recovery` is the commit to
    /// return to for an undo in every case.
    enum MergeOutcome {
        case merged(recovery: String, files: [String])
        case conflict([String], recovery: String)
        case failed(String)
    }

    /// Bring `incomingBranch` into `repoDir`'s current version. If it conflicts,
    /// aborts cleanly (leaving `repoDir` untouched) and reports the clashing files
    /// for a human to resolve — never guesses a resolution. Never deletes the
    /// source branch or worktree.
    static func merge(incomingBranch: String, into repoDir: String) -> MergeOutcome {
        guard let recovery = headCommit(of: repoDir) else {
            return .failed("The main version has no saved history to combine into.")
        }
        let m = git(["-C", repoDir,
                     "-c", "user.email=agent@idealize.local", "-c", "user.name=IDEalize",
                     "merge", "--no-ff", "--no-edit", incomingBranch])
        if let m, m.status == 0 {
            return .merged(recovery: recovery, files: changedNames(repoDir, range: "\(recovery)..HEAD"))
        }
        let conflicts = conflictedPaths(repoDir)
        _ = git(["-C", repoDir, "merge", "--abort"])   // restore repoDir to `recovery`
        if !conflicts.isEmpty { return .conflict(conflicts, recovery: recovery) }
        return .failed("I couldn't combine this copy automatically, so I've left everything as it was.")
    }

    // MARK: - git plumbing (kept private to this file)

    private static func revExists(_ dir: String, _ ref: String) -> Bool {
        git(["-C", dir, "rev-parse", "--verify", "--quiet", ref + "^{commit}"])?.status == 0
    }

    private static func countRevs(_ dir: String, _ range: String) -> Int {
        guard let r = git(["-C", dir, "rev-list", "--count", range]), r.status == 0 else { return 0 }
        return Int(r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
    }

    private static func changedNames(_ dir: String, range: String) -> [String] {
        guard let r = git(["-C", dir, "diff", "--name-only", range]), r.status == 0 else { return [] }
        return r.stdout.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    }

    private static func conflictedPaths(_ dir: String) -> [String] {
        guard let r = git(["-C", dir, "diff", "--name-only", "--diff-filter=U"]), r.status == 0 else { return [] }
        return r.stdout.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    }

    private static func tailLines(_ s: String, _ n: Int) -> String {
        let lines = s.split(separator: "\n", omittingEmptySubsequences: false)
        return lines.suffix(n).joined(separator: "\n")
    }

    private static func headCommit(of dir: String) -> String? {
        guard let r = git(["-C", dir, "rev-parse", "HEAD"]), r.status == 0 else { return nil }
        let sha = r.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        return sha.isEmpty ? nil : sha
    }

    /// `git worktree list` reports branches as `refs/heads/<name>`; strip that so
    /// `branch -D` gets the short name.
    private static func branchName(_ ref: String) -> String {
        ref.hasPrefix("refs/heads/") ? String(ref.dropFirst("refs/heads/".count)) : ref
    }

    /// Turn a free-text task label into a short, filesystem-safe slug so a copy's
    /// directory hints at what it's for (best-effort; empty is fine).
    private static func slugify(_ label: String?) -> String {
        guard let label else { return "" }
        let mapped = label.lowercased().map { ch -> Character in
            (ch.isLetter || ch.isNumber) ? ch : "-"
        }
        let collapsed = String(mapped).split(separator: "-").joined(separator: "-")
        return String(collapsed.prefix(24))
    }

    /// Run git via `/usr/bin/env` (so PATH resolves it) with prompts disabled, so
    /// a credential/auth prompt can never hang the call.
    @discardableResult
    private static func git(_ args: [String], timeout: TimeInterval = 60) -> ProcResult? {
        Subprocess.run("/usr/bin/env", ["git"] + args,
                       extraEnv: ["GIT_TERMINAL_PROMPT": "0"],
                       timeout: timeout)
    }
}
