import XCTest
@testable import IDEalizeApp

/// The lead agent's launch composition and home: the guide arrives invisibly on
/// a Claude launch and not at all on anything else, the model flag follows the
/// same rules as the project agent's, and the Fleet home is a real folder under
/// the app's own support directory that the project-agent machinery refuses to
/// treat as a project.
final class LeadAgentLaunchTests: XCTestCase {

    private var savedCommand = ""
    private var savedModel = ""

    override func setUp() {
        super.setUp()
        savedCommand = AppSettings.shared.leadAgentLaunchCommand
        savedModel = AppSettings.shared.leadAgentModel
        AppSettings.shared.leadAgentLaunchCommand = ""
        AppSettings.shared.leadAgentModel = ""
    }

    override func tearDown() {
        AppSettings.shared.leadAgentLaunchCommand = savedCommand
        AppSettings.shared.leadAgentModel = savedModel
        super.tearDown()
    }

    func testClaudeLaunchCarriesTheGuideInvisiblyAndOpensWithTheLeadTurn() {
        let launch = LeadAgent.launch()
        XCTAssertTrue(TerminalSession.isClaudeCommand(launch.command), launch.command)
        XCTAssertTrue(launch.command.contains("--append-system-prompt"), launch.command)
        // The guide read is the *effective* prompt URL, quoted for the shell.
        XCTAssertTrue(launch.command.contains(LeadAgent.promptURL().lastPathComponent),
                      launch.command)
        XCTAssertEqual(launch.openingTurn, "/lead-agent")
    }

    func testModelIsAppliedToAClaudeLaunch() {
        AppSettings.shared.leadAgentModel = "haiku"
        let launch = LeadAgent.launch()
        XCTAssertTrue(launch.command.contains("--model 'haiku'"), launch.command)
    }

    func testANonClaudeCommandTakesNeitherGuideNorModel() {
        AppSettings.shared.leadAgentLaunchCommand = "kimi"
        AppSettings.shared.leadAgentModel = "haiku"
        let launch = LeadAgent.launch()
        XCTAssertEqual(launch.command, "kimi")
        XCTAssertEqual(launch.openingTurn, "/lead-agent")
    }

    func testFleetHomeLivesUnderTheAppsOwnSupportDir() {
        XCTAssertTrue(LeadAgent.fleetHomeURL.path.hasPrefix(AppPaths.supportDir.path),
                      LeadAgent.fleetHomeURL.path)
    }

    func testFleetHomeIsNeverTreatedAsAProject() {
        // The lead's folder must not grow its own project agent or accept
        // spawned worker chats.
        XCTAssertFalse(ProjectAgent.isCoordinatable(LeadAgent.fleetHomeURL.path))
    }

    func testLegacySnapshotDecodesWithLeadFlagDefaultingFalse() throws {
        // A record written before `isLeadAgent` (and `isProjectAgent`) existed.
        let json = Data(#"{"customName":"Old chat","wasClaude":true}"#.utf8)
        let chat = try JSONDecoder().decode(PersistedChat.self, from: json)
        XCTAssertFalse(chat.isLeadAgent)
        XCTAssertFalse(chat.isProjectAgent)
        XCTAssertEqual(chat.effectiveAgentBinary, "claude")
    }
}
