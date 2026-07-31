import XCTest
@testable import IDEalizeApp

/// Exercises the Safe-Copies / Review-and-Combine engine against real throwaway
/// git repositories. This is the riskiest piece of the project-agent work — the
/// merge must be genuinely reversible and must never silently lose work — so it
/// is tested end-to-end with actual `git`, not mocked.
final class WorktreeServiceTests: XCTestCase {
    private var tempDirs: [String] = []

    override func tearDown() {
        for d in tempDirs { try? FileManager.default.removeItem(atPath: d) }
        tempDirs = []
        super.tearDown()
    }

    // MARK: - git helpers (self-contained; independent of WorktreeService's own plumbing)

    /// Run git in `dir` with a fixed identity, so tests don't depend on the
    /// machine's global git config.
    @discardableResult
    private func git(_ args: [String], in dir: String) -> ProcResult? {
        Subprocess.run("/usr/bin/env", ["git"] + args, cwd: dir,
                       extraEnv: ["GIT_TERMINAL_PROMPT": "0",
                                  "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                                  "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"])
    }

    private func tempDir() -> String {
        let dir = NSTemporaryDirectory() + "idealize-wt-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        tempDirs.append(dir)
        return dir
    }

    private func write(_ dir: String, _ name: String, _ contents: String) {
        try? contents.write(toFile: dir + "/" + name, atomically: true, encoding: .utf8)
    }

    private func read(_ dir: String, _ name: String) -> String? {
        try? String(contentsOfFile: dir + "/" + name, encoding: .utf8)
    }

    private func commitAll(_ dir: String, _ message: String) {
        git(["add", "-A"], in: dir)
        git(["commit", "-q", "-m", message], in: dir)
    }

    /// A fresh repo with one commit ("a.txt" = "base"). Returns (path, defaultBranch).
    private func makeRepoWithBase() throws -> (repo: String, branch: String) {
        let repo = tempDir()
        guard git(["init", "-q"], in: repo) != nil else {
            throw XCTSkip("git is not available in this environment")
        }
        write(repo, "a.txt", "base\n")
        commitAll(repo, "base")
        let branch = git(["rev-parse", "--abbrev-ref", "HEAD"], in: repo)?
            .stdout.trimmingCharacters(in: .whitespacesAndNewlines) ?? "main"
        return (repo, branch)
    }

    private func head(_ dir: String) -> String? {
        git(["rev-parse", "HEAD"], in: dir)?.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - create / diff (isolation)

    func testCreateMakesAnIsolatedCopyAndDiffSeesItsChanges() throws {
        let (repo, _) = try makeRepoWithBase()
        guard let copy = WorktreeService.create(from: repo, label: "hero section") else {
            return XCTFail("create should succeed for a repo with a commit")
        }
        // Clean up the worktree (it lives outside the repo, under Application Support).
        defer { WorktreeService.remove(copy, from: repo) }

        XCTAssertEqual(copy.base, head(repo), "copy is taken from the project's current commit")
        XCTAssertTrue(copy.branch.hasPrefix("idealize/safe-copy/"), "copy sits on its own safe-copy branch")
        XCTAssertTrue(copy.path.contains("safe-copies"), "copy lives in the safe-copies area, not the project")

        // A change made inside the copy is visible in its diff...
        write(copy.path, "b.txt", "new work\n")
        let diff = WorktreeService.diff(worktree: copy.path, base: copy.base)
        XCTAssertEqual(diff?.files.first(where: { $0.path == "b.txt" })?.change, "new")

        // ...and the user's original folder is left completely untouched.
        XCTAssertTrue(WorktreeService.isClean(repo), "isolation must not disturb the main folder")
        XCTAssertNil(read(repo, "b.txt"), "the copy's new file must not appear in the project")
    }

    func testCanIsolateIsFalseWithoutARepo() {
        let plain = tempDir()
        XCTAssertFalse(WorktreeService.canIsolate(plain))
        XCTAssertNil(WorktreeService.create(from: plain), "no repo → no safe copy, caller falls back to shared")
    }

    // MARK: - combine: clean

    func testCombineBringsInACleanCopyAndRecordsARecoveryPoint() throws {
        let (repo, main) = try makeRepoWithBase()
        // A divergent branch that only adds a file — no overlap with main.
        git(["checkout", "-q", "-b", "feature"], in: repo)
        write(repo, "b.txt", "feature work\n")
        commitAll(repo, "feature")
        git(["checkout", "-q", main], in: repo)
        let before = head(repo)

        switch WorktreeService.merge(incomingBranch: "feature", into: repo) {
        case .merged(let recovery, let files):
            XCTAssertEqual(recovery, before, "recovery point is where the main version started")
            XCTAssertTrue(files.contains("b.txt"), "the brought-in file is reported")
            XCTAssertEqual(read(repo, "b.txt"), "feature work\n", "the change actually landed")
            XCTAssertTrue(WorktreeService.isClean(repo), "no half-merged mess left behind")
        default:
            XCTFail("a non-overlapping copy should combine cleanly")
        }
    }

    // MARK: - combine: conflict is safe (the load-bearing guarantee)

    func testCombineConflictLeavesTheMainVersionUntouched() throws {
        let (repo, main) = try makeRepoWithBase()
        // Both sides change the SAME line → a real conflict.
        git(["checkout", "-q", "-b", "feature"], in: repo)
        write(repo, "a.txt", "feature\n")
        commitAll(repo, "feature edits a.txt")
        git(["checkout", "-q", main], in: repo)
        write(repo, "a.txt", "mainline\n")
        commitAll(repo, "main edits a.txt")
        let before = head(repo)

        switch WorktreeService.merge(incomingBranch: "feature", into: repo) {
        case .conflict(let files, let recovery):
            XCTAssertEqual(files, ["a.txt"], "the clashing file is reported by name")
            XCTAssertEqual(recovery, before, "recovery point is the pre-combine state")
            // The cardinal guarantee: nothing was combined, nothing was lost.
            XCTAssertEqual(head(repo), before, "HEAD is exactly where it was — the merge was aborted")
            XCTAssertEqual(read(repo, "a.txt"), "mainline\n", "the main version's content is intact")
            XCTAssertTrue(WorktreeService.isClean(repo), "no dangling conflict markers or MERGE_HEAD")
        default:
            XCTFail("overlapping edits on the same line must be reported as a conflict, not merged")
        }
    }

    // MARK: - trial merge (read-only preview) agrees with reality

    func testTrialMergeDistinguishesCleanFromConflict() throws {
        // Clean scenario.
        let (cleanRepo, cleanMain) = try makeRepoWithBase()
        git(["checkout", "-q", "-b", "feature"], in: cleanRepo)
        write(cleanRepo, "b.txt", "add\n"); commitAll(cleanRepo, "add b")
        git(["checkout", "-q", cleanMain], in: cleanRepo)
        if case .conflicts = WorktreeService.trialMerge(into: "HEAD", incoming: "feature", in: cleanRepo) {
            XCTFail("a non-overlapping branch must not be predicted as a conflict")
        }

        // Conflict scenario.
        let (conflictRepo, conflictMain) = try makeRepoWithBase()
        git(["checkout", "-q", "-b", "feature"], in: conflictRepo)
        write(conflictRepo, "a.txt", "feature\n"); commitAll(conflictRepo, "feature")
        git(["checkout", "-q", conflictMain], in: conflictRepo)
        write(conflictRepo, "a.txt", "mainline\n"); commitAll(conflictRepo, "main")
        if case .clean = WorktreeService.trialMerge(into: "HEAD", incoming: "feature", in: conflictRepo) {
            XCTFail("clashing edits must not be predicted as clean")
        }
    }

    // MARK: - verify is honest

    func testVerifyReportsNoCheckRatherThanFakingAPass() {
        let plain = tempDir()   // no Package.swift → no known check
        let result = WorktreeService.verify(plain)
        XCTAssertFalse(result.ran, "with no known check, verify must not claim to have run one")
        XCTAssertNil(result.passed, "and must not report a pass it never observed")
    }

    func testVerifyRunsAnAttachedCheckAndReportsAPass() {
        let dir = tempDir()
        let result = WorktreeService.verify(dir, check: "exit 0")
        XCTAssertTrue(result.ran)
        XCTAssertEqual(result.passed, true)
        XCTAssertEqual(result.check, "exit 0", "the result must say which command proved it")
    }

    func testVerifyReportsAFailingCheckWithItsOutput() {
        let dir = tempDir()
        let result = WorktreeService.verify(dir, check: "echo boom >&2; exit 1")
        XCTAssertTrue(result.ran)
        XCTAssertEqual(result.passed, false)
        XCTAssertTrue(result.tail.contains("boom"),
                      "the failing output travels back so the chat can be told what broke")
    }

    func testAttachedCheckWinsOverAutodetect() {
        let dir = tempDir()
        write(dir, "Package.swift", "// swift-tools-version:5.9\n")  // would autodetect swift build
        let result = WorktreeService.verify(dir, check: "true")
        XCTAssertEqual(result.check, "true", "an attached check must run instead of the built-in build")
        XCTAssertEqual(result.passed, true)
    }

    func testEmptyCheckFallsBackToAutodetect() {
        let plain = tempDir()
        let result = WorktreeService.verify(plain, check: "   ")
        XCTAssertFalse(result.ran, "a blank check means 'not attached', never a run")
    }

    func testCheckRunsInTheChatsOwnFolder() {
        let dir = tempDir()
        write(dir, "marker.txt", "here\n")
        let result = WorktreeService.verify(dir, check: "test -f marker.txt")
        XCTAssertEqual(result.passed, true, "the check must execute in the given directory")
    }
}
