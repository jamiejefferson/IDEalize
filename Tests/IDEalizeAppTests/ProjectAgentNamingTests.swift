import XCTest
@testable import IDEalizeApp

/// Names the project agent derives for the chats it spawns. The coordinating
/// guide tells it to brief each chat with the route to live, the definition of
/// done and any traps — so the realistic input here is a paragraph, not a title,
/// and the interesting cases are all about not putting prose in the sidebar.
final class ProjectAgentNamingTests: XCTestCase {

    func testUsesTheFirstSentenceRatherThanTheFirstFewWords() {
        // The failure this guards against: taking the opening words of a brief and
        // labelling the tab "Rebuild the footer so the" — or worse, "You are".
        let name = ProjectAgent.chatName(fromTask:
            "Rebuild the footer so the newsletter form sits beside the social links. "
            + "It goes live from the website repo, not this folder. Done means visible "
            + "on the live site at desktop width.")
        XCTAssertEqual(name, "Rebuild the footer so the…")
    }

    func testReadsOnlyTheFirstLineOfAMultiLineBrief() {
        let name = ProjectAgent.chatName(fromTask: """
            Newsletter form
            Route to live: ships from the website repo.
            Done when: it validates and the success state shows.
            """)
        XCTAssertEqual(name, "Newsletter form")
    }

    func testStripsMarkdownHeadingAndListDecoration() {
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "## Footer layout"), "Footer layout")
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "- fix the nav spacing"), "Fix the nav spacing")
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "• Live site check"), "Live site check")
    }

    func testKeepsAShortSentenceWholeWithoutTrailingPunctuation() {
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "Redo the nav bar."), "Redo the nav bar")
    }

    func testDoesNotTruncateToAUselessStub() {
        // "Fix it" is only 6 characters, so cutting at the full stop would leave
        // less than the sentence-cut threshold — better to keep what's there.
        let name = ProjectAgent.chatName(fromTask: "Fix it. The button is the wrong colour on mobile.")
        XCTAssertNotNil(name)
        XCTAssertTrue(name!.hasPrefix("Fix it"), "got \(name!)")
    }

    func testSentenceCasesALowercaseOpenerButLeavesAcronymsAlone() {
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "rebuild the hero"), "Rebuild the hero")
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "iOS share sheet"), "iOS share sheet")
        XCTAssertEqual(ProjectAgent.chatName(fromTask: "CSS grid fallback"), "CSS grid fallback")
    }

    func testNeverExceedsTheRailWidthAndBreaksOnAWordBoundary() {
        let name = ProjectAgent.chatName(fromTask:
            "Investigate why the newsletter subscription confirmation email never arrives")
        let n = try! XCTUnwrap(name)
        XCTAssertLessThanOrEqual(n.count, 33, "\(n.count) chars: \(n)")
        // Truncation is marked, and doesn't leave a half-word before the ellipsis.
        XCTAssertTrue(n.hasSuffix("…"))
        XCTAssertFalse(n.dropLast().hasSuffix(" "))
    }

    func testReturnsNilWhenNothingUsableSurvives() {
        // nil leaves the tab on its normal folder-derived name, which beats
        // replacing it with punctuation or an empty string.
        XCTAssertNil(ProjectAgent.chatName(fromTask: ""))
        XCTAssertNil(ProjectAgent.chatName(fromTask: "   \n\t  "))
        XCTAssertNil(ProjectAgent.chatName(fromTask: "###"))
        XCTAssertNil(ProjectAgent.chatName(fromTask: "- - -"))
    }

    func testACallerSuppliedNameIsAlsoCappedSoItCannotFillTheSidebar() {
        // The spawn handler runs `--name` through the same function, so a caller
        // that passes a whole sentence still gets a label.
        let n = try! XCTUnwrap(ProjectAgent.chatName(fromTask:
            "Footer layout and the newsletter form and also the social links"))
        XCTAssertLessThanOrEqual(n.count, 33)
    }
}
