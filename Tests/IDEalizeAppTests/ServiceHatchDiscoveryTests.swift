import XCTest
@testable import IDEalizeApp

/// The service hatch has to find IDEalize's own source without being told where it
/// is. The risk isn't failing to find a checkout — it's finding the *wrong* one: a
/// safe-copy worktree or an archived backup looks exactly like the real thing to a
/// `Package.swift` + `Sources/IDEalizeApp` test.
final class ServiceHatchDiscoveryTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hatch-discovery-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// Build something that passes `isRepo`: the two markers the app looks for.
    @discardableResult
    private func makeCheckout(_ relativePath: String) throws -> String {
        let dir = root.appendingPathComponent(relativePath)
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("Sources/IDEalizeApp"),
                                                withIntermediateDirectories: true)
        try "// swift-tools-version:5.9\n".write(to: dir.appendingPathComponent("Package.swift"),
                                                 atomically: true, encoding: .utf8)
        return dir.path
    }

    func testRecognisesARealCheckout() throws {
        let path = try makeCheckout("IDEalize")
        XCTAssertTrue(ServiceHatch.isRepo(path))
    }

    func testMissingEitherMarkerIsNotACheckout() throws {
        let bare = root.appendingPathComponent("NotIDEalize")
        try FileManager.default.createDirectory(at: bare, withIntermediateDirectories: true)
        XCTAssertFalse(ServiceHatch.isRepo(bare.path))

        // Package.swift alone isn't enough — that's every Swift package on the disk.
        try "".write(to: bare.appendingPathComponent("Package.swift"), atomically: true, encoding: .utf8)
        XCTAssertFalse(ServiceHatch.isRepo(bare.path))
    }

    /// The important one: these all satisfy `isRepo`, and adopting any of them would
    /// send the hatch to edit a throwaway copy instead of the source.
    func testWorktreesBackupsAndBuildOutputAreExcluded() throws {
        let decoys = [
            "project/.claude/worktrees/agent-1/IDEalize",
            "project/safe-copies/ship-piece/IDEalize",
            "IDEalize Backups/2026-07-14-archive/IDEalize",
            "project/dist/IDEalize",
        ]
        for decoy in decoys {
            let path = try makeCheckout(decoy)
            XCTAssertTrue(ServiceHatch.isRepo(path),
                          "precondition: \(decoy) should look like a checkout")
            XCTAssertFalse(ServiceHatch.isPlausibleSource(path),
                           "\(decoy) should be excluded from discovery")
        }
    }

    func testAnOrdinaryCheckoutIsNotExcluded() throws {
        let path = try makeCheckout("Documents/_AppDev/IDEalize")
        XCTAssertTrue(ServiceHatch.isPlausibleSource(path))
    }

    /// A linked worktree stores `.git` as a file pointing at its parent repo. This is
    /// what rules out worktree schemes whose folder names we don't know in advance —
    /// Conductor's `~/conductor/workspaces/…`, for one.
    func testALinkedGitWorktreeIsExcluded() throws {
        let path = try makeCheckout("workspaces/IDEalize/astana")
        try "gitdir: /Users/someone/Documents/IDEalize/.git/worktrees/astana\n"
            .write(to: URL(fileURLWithPath: path + "/.git"), atomically: true, encoding: .utf8)
        XCTAssertTrue(ServiceHatch.isRepo(path), "precondition: a worktree looks like a checkout")
        XCTAssertFalse(ServiceHatch.isPlausibleSource(path))
    }

    func testACloneWithARealGitDirectoryIsKept() throws {
        let path = try makeCheckout("Documents/_AppDev/IDEalize")
        try FileManager.default.createDirectory(atPath: path + "/.git", withIntermediateDirectories: true)
        XCTAssertTrue(ServiceHatch.isPlausibleSource(path))
    }

    /// Discovery must never return a path that isn't a checkout, whatever Spotlight
    /// and the folder scan turn up on the machine running the tests.
    func testDiscoveryOnlyEverReturnsValidCheckouts() {
        for path in ServiceHatch.discover() {
            XCTAssertTrue(ServiceHatch.isRepo(path), "discover() returned a non-checkout: \(path)")
            XCTAssertTrue(ServiceHatch.isPlausibleSource(path),
                          "discover() returned an excluded path: \(path)")
        }
    }
}
