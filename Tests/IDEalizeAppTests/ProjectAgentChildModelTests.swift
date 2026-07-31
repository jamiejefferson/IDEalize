import XCTest
@testable import IDEalizeApp

/// Per-spawn model routing: a coordinator can hand a well-specified mechanical
/// piece to a cheaper model (`idealize spawn --model haiku`) without touching
/// the role-wide child-model setting — and the override must never leak a
/// Claude flag onto a non-Claude agent.
final class ProjectAgentChildModelTests: XCTestCase {
    private var savedCommand = ""
    private var savedChildModel = ""

    override func setUp() {
        super.setUp()
        savedCommand = AppSettings.shared.defaultLaunchCommand
        savedChildModel = AppSettings.shared.projectAgentChildModel
        AppSettings.shared.defaultLaunchCommand = ""
        AppSettings.shared.projectAgentChildModel = ""
    }

    override func tearDown() {
        AppSettings.shared.defaultLaunchCommand = savedCommand
        AppSettings.shared.projectAgentChildModel = savedChildModel
        super.tearDown()
    }

    func testAPerSpawnModelIsAppliedToTheChildCommand() {
        let launch = ProjectAgent.childLaunch(initialPrompt: nil, model: "haiku")
        XCTAssertTrue(launch.command.contains("--model 'haiku'"), launch.command)
    }

    func testAPerSpawnModelBeatsTheRoleWideChildModel() {
        AppSettings.shared.projectAgentChildModel = "opus"
        let launch = ProjectAgent.childLaunch(initialPrompt: nil, model: "haiku")
        XCTAssertTrue(launch.command.contains("--model 'haiku'"), launch.command)
        XCTAssertFalse(launch.command.contains("opus"), launch.command)
    }

    func testABlankOverrideFallsBackToTheRoleWideChildModel() {
        AppSettings.shared.projectAgentChildModel = "opus"
        let launch = ProjectAgent.childLaunch(initialPrompt: nil, model: "   ")
        XCTAssertTrue(launch.command.contains("--model 'opus'"), launch.command)
    }

    func testNoModelAnywhereAppendsNothing() {
        let launch = ProjectAgent.childLaunch(initialPrompt: nil)
        XCTAssertFalse(launch.command.contains("--model"), launch.command)
    }

    func testANonClaudeAgentIsNeverHandedAClaudeModelFlag() {
        AppSettings.shared.defaultLaunchCommand = "kimi"
        let launch = ProjectAgent.childLaunch(initialPrompt: nil, model: "haiku")
        XCTAssertFalse(launch.command.contains("--model"), launch.command)
    }
}
