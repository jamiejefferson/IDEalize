import XCTest
@testable import IDEalizeApp

final class ProjectMonitorTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    // MARK: - ActivityLedger

    func testSingleChatEditingIsNeverAnOverlap() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0))
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0 + 60))
    }

    func testTwoChatsOnTheSameFileOverlap() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0))
        let hit = ledger.record(path: "/p/a.swift", source: .session("t-2"), at: t0 + 60)
        XCTAssertEqual(hit?.0, "t-1")   // the earlier chat
        XCTAssertEqual(hit?.1, "t-2")   // the newcomer that made it overlap
    }

    func testDifferentFilesDoNotOverlap() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0))
        XCTAssertNil(ledger.record(path: "/p/b.swift", source: .session("t-2"), at: t0 + 60))
    }

    func testTouchesOutsideTheWindowAreStale() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0))
        // 16 minutes later: beyond the 15-minute window, no overlap.
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-2"), at: t0 + 16 * 60))
    }

    func testCooldownSuppressesRepeatReports() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0))
        XCTAssertNotNil(ledger.record(path: "/p/a.swift", source: .session("t-2"), at: t0 + 60))
        // Same pair, 5 minutes on: still overlapping but inside the cooldown.
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0 + 5 * 60))
        // A fresh overlap after the cooldown reports again.
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0 + 16 * 60 + 40))
        XCTAssertNotNil(ledger.record(path: "/p/a.swift", source: .session("t-2"), at: t0 + 16 * 60 + 50))
    }

    func testExternalChangesNeverOverlap() {
        var ledger = ActivityLedger()
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .external, at: t0))
        // An external touch doesn't count as an "other chat" either.
        XCTAssertNil(ledger.record(path: "/p/a.swift", source: .session("t-1"), at: t0 + 10))
    }

    // MARK: - Path filtering

    func testSignificantPathFiltering() {
        let root = "/p"
        XCTAssertTrue(ProjectMonitor.isSignificant("/p/src/a.swift", within: root))
        XCTAssertTrue(ProjectMonitor.isSignificant("/p/index.html", within: root))
        // VCS internals, dependencies, and dot-dirs (incl. the agent's own
        // .idealize/ notes) are noise.
        XCTAssertFalse(ProjectMonitor.isSignificant("/p/.git/index", within: root))
        XCTAssertFalse(ProjectMonitor.isSignificant("/p/node_modules/pkg/index.js", within: root))
        XCTAssertFalse(ProjectMonitor.isSignificant("/p/.idealize/project-notes.md", within: root))
        // Outside the project — including the `/p` vs `/p2` prefix trap.
        XCTAssertFalse(ProjectMonitor.isSignificant("/other/a.swift", within: root))
        XCTAssertFalse(ProjectMonitor.isSignificant("/p2/a.swift", within: root))
    }
}
