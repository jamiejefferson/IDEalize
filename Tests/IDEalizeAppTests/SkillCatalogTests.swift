import XCTest
@testable import IDEalizeApp

final class SkillCatalogTests: XCTestCase {

    /// Command names are typed verbatim into the shell when clicked, so files
    /// whose base name contains shell metacharacters must never be offered.
    func testCommandCatalogSkipsUnsafeNames() throws {
        let dir = NSTemporaryDirectory() + "idealize-cat-\(UUID().uuidString)"
        let cmdDir = dir + "/.claude/commands"
        try FileManager.default.createDirectory(atPath: cmdDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let safe = "zz-safe-cmd"
        let unsafe = ["zz-evil$(reboot)", "zz-evil;rm", "zz-evil`id`", "zz-evil name", "zz-evil&x"]
        try "safe".write(toFile: "\(cmdDir)/\(safe).md", atomically: true, encoding: .utf8)
        for name in unsafe {
            try "evil".write(toFile: "\(cmdDir)/\(name).md", atomically: true, encoding: .utf8)
        }

        let (_, commands) = SkillCatalog.load(projectPath: dir)
        let names = commands.map(\.name)
        XCTAssertTrue(names.contains(safe), "a well-formed command should be listed")
        for name in unsafe {
            XCTAssertFalse(names.contains(name), "'\(name)' has shell metacharacters and must be skipped")
        }
    }
}
