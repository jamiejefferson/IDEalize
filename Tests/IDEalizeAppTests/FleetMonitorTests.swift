import XCTest
@testable import IDEalizeApp

/// The fleet ledger's contract: the starting shape is baseline, an agent
/// vanishing over live chats is news exactly once, and unread mail nudges only
/// after it has sat on an idle session past the threshold — once per episode.
final class FleetMonitorTests: XCTestCase {

    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    private func project(_ path: String, agent: String?, members: Int)
        -> FleetLedger.ProjectState {
        FleetLedger.ProjectState(path: path, agentID: agent, memberCount: members)
    }

    private func inbox(_ id: String, unread: Int, busy: Bool = false)
        -> FleetLedger.InboxState {
        FleetLedger.InboxState(sessionID: id, unread: unread, busy: busy)
    }

    func testAgentsPresentAtStartAreBaselineNotNews() {
        var ledger = FleetLedger()
        let events = ledger.observe(
            projects: [project("/a", agent: "t-aaaa", members: 2),
                       project("/b", agent: "t-bbbb", members: 1)],
            inboxes: [], at: t0)
        XCTAssertEqual(events, [])
    }

    func testANewAgentAppearsOnce() {
        var ledger = FleetLedger()
        _ = ledger.observe(projects: [project("/a", agent: nil, members: 1)],
                           inboxes: [], at: t0)
        let events = ledger.observe(
            projects: [project("/a", agent: "t-aaaa", members: 1)],
            inboxes: [], at: t0.addingTimeInterval(1))
        XCTAssertEqual(events, [.agentAppeared(project: "/a", agentID: "t-aaaa")])
        let again = ledger.observe(
            projects: [project("/a", agent: "t-aaaa", members: 1)],
            inboxes: [], at: t0.addingTimeInterval(2))
        XCTAssertEqual(again, [])
    }

    func testAgentDisappearingOverLiveChatsFiresOnce() {
        var ledger = FleetLedger()
        _ = ledger.observe(projects: [project("/a", agent: "t-aaaa", members: 2)],
                           inboxes: [], at: t0)
        let events = ledger.observe(projects: [project("/a", agent: nil, members: 2)],
                                    inboxes: [], at: t0.addingTimeInterval(1))
        XCTAssertEqual(events, [.agentDisappeared(project: "/a", membersRemaining: 2)])
        // Still unwatched on the next tick — but that's no longer news.
        let again = ledger.observe(projects: [project("/a", agent: nil, members: 2)],
                                   inboxes: [], at: t0.addingTimeInterval(2))
        XCTAssertEqual(again, [])
    }

    func testAgentClosingWithItsProjectIsNotAnUnwatchedProject() {
        var ledger = FleetLedger()
        _ = ledger.observe(projects: [project("/a", agent: "t-aaaa", members: 1)],
                           inboxes: [], at: t0)
        // The whole project wound down: agent gone AND no members left.
        let events = ledger.observe(projects: [project("/a", agent: nil, members: 0)],
                                    inboxes: [], at: t0.addingTimeInterval(1))
        XCTAssertEqual(events, [])
    }

    func testUnreadMailNudgesOnlyAfterTheThresholdAndOncePerEpisode() {
        var ledger = FleetLedger()
        _ = ledger.observe(projects: [], inboxes: [inbox("t-lead", unread: 2)], at: t0)
        // Under the threshold: quiet.
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-lead", unread: 2)],
                                      at: t0.addingTimeInterval(60)), [])
        // Past it: one nudge.
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-lead", unread: 3)],
                                      at: t0.addingTimeInterval(121)),
                       [.staleInbox(sessionID: "t-lead", unread: 3)])
        // Still unread: no repeat within the same episode.
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-lead", unread: 3)],
                                      at: t0.addingTimeInterval(300)), [])
        // Drained, then mail arrives again: a fresh episode may nudge again.
        _ = ledger.observe(projects: [], inboxes: [inbox("t-lead", unread: 0)],
                           at: t0.addingTimeInterval(310))
        _ = ledger.observe(projects: [], inboxes: [inbox("t-lead", unread: 1)],
                           at: t0.addingTimeInterval(320))
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-lead", unread: 1)],
                                      at: t0.addingTimeInterval(500)),
                       [.staleInbox(sessionID: "t-lead", unread: 1)])
    }

    func testABusySessionIsNeverNudgedButTheClockKeepsRunning() {
        var ledger = FleetLedger()
        _ = ledger.observe(projects: [], inboxes: [inbox("t-pa", unread: 1, busy: true)], at: t0)
        // Past the threshold but mid-task: hold the nudge.
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-pa", unread: 1, busy: true)],
                                      at: t0.addingTimeInterval(200)), [])
        // The moment it idles, the overdue nudge fires.
        XCTAssertEqual(ledger.observe(projects: [],
                                      inboxes: [inbox("t-pa", unread: 1)],
                                      at: t0.addingTimeInterval(201)),
                       [.staleInbox(sessionID: "t-pa", unread: 1)])
    }
}
