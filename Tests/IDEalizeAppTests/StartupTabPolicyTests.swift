import XCTest
@testable import IDEalizeApp

final class StartupTabPolicyTests: XCTestCase {
    func testEmptyWorkspaceCreatesHomeTabRegardlessOfWelcomeHistory() {
        for hasSeenWelcome in [false, true] {
            XCTAssertTrue(
                StartupTabPolicy.shouldCreateHomeTab(existingTabCount: 0),
                "Expected a Home tab when hasSeenWelcome is \(hasSeenWelcome)"
            )
        }
    }

    func testNonemptyWorkspaceDoesNotCreateDuplicateHomeTab() {
        XCTAssertFalse(StartupTabPolicy.shouldCreateHomeTab(existingTabCount: 1))
    }
}
