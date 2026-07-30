import XCTest
@testable import IDEalizeApp

/// Regression tests for the launch-command mangling family: the assembled command
/// used to include the opening turn, and everything that rewrote or inspected the
/// command therefore read the user's prose. Each test below is a bug that shipped.
final class AgentLaunchTests: XCTestCase {

    // MARK: - Permission-mode rewriting must not touch the opening turn

    func testPermissionRewriteNoLongerSeesTheOpeningTurnAtAll() {
        // The turn isn't in the string being rewritten any more, so flag-looking
        // prose inside a brief simply cannot be stripped. Prove the split holds:
        // the brief lives on `openingTurn`, not in `command`.
        let launch = ProjectAgent.childLaunch(initialPrompt:
            "Set --permission-mode on the deploy script and mention -r in the README")
        XCTAssertFalse(launch.command.contains("--permission-mode"))
        XCTAssertFalse(launch.command.contains("-r"))
        XCTAssertEqual(launch.openingTurn,
            "Set --permission-mode on the deploy script and mention -r in the README")
    }

    func testStrippingPermissionFlagsLeavesNoDoubleSpaceToTidyUp() {
        // The old code stripped the flag then collapsed every run of spaces in the
        // whole command — which also rewrote whitespace inside quoted arguments.
        // `.plan`, not `.yolo` — yolo's own flag *is*
        // --dangerously-skip-permissions, so it's legitimately re-added and can't
        // show whether the strip worked.
        let out = TerminalSession.applyingPermissionMode(
            .plan, to: "claude --dangerously-skip-permissions --add-dir /tmp/x")
        XCTAssertFalse(out.contains("  "), "double space left behind: \(out)")
        XCTAssertFalse(out.contains("--dangerously-skip-permissions"), out)
        XCTAssertEqual(out, "claude --add-dir /tmp/x --permission-mode plan")
    }

    func testAQuotedPathContainingDoubleSpacesSurvivesTheRewrite() {
        // A folder named with two consecutive spaces used to be silently corrupted
        // by the global whitespace collapse.
        let cmd = "claude --dangerously-skip-permissions --add-dir '/tmp/two  spaces/x'"
        let out = TerminalSession.applyingPermissionMode(.yolo, to: cmd)
        XCTAssertTrue(out.contains("/tmp/two  spaces/x"), out)
    }

    func testReplacingAnExistingPermissionModeFlag() {
        let out = TerminalSession.applyingPermissionMode(
            .yolo, to: "claude --permission-mode plan --add-dir /tmp/x")
        XCTAssertFalse(out.contains("plan"), out)
        XCTAssertFalse(out.contains("  "), out)
        XCTAssertTrue(out.contains("--add-dir /tmp/x"), out)
    }

    // MARK: - Agent detection must not read the brief

    func testABriefMentioningClaudeDoesNotMakeANonClaudeLaunchLookLikeClaude() {
        // The bug: detection ran on command-plus-brief, so `kimi` handed a brief
        // that mentioned claude got Claude-only flags bolted on and failed to start.
        let launch = AgentLaunch(command: "kimi",
                                 openingTurn: "port this from claude to kimi")
        XCTAssertFalse(TerminalSession.isClaudeCommand(launch.command))
    }

    func testClaudeDetectionIsCaseInsensitive() {
        // isClaudeCommand was case-sensitive while the adapter lookup lowercased, so
        // a capitalised command was an agent by one test and not the other.
        XCTAssertTrue(TerminalSession.isClaudeCommand("Claude --dangerously-skip-permissions"))
        XCTAssertTrue(TerminalSession.isClaudeCommand("claude"))
        XCTAssertTrue(TerminalSession.isClaudeCommand("/opt/homebrew/bin/claude --foo"))
        XCTAssertFalse(TerminalSession.isClaudeCommand("kimi"))
        XCTAssertFalse(TerminalSession.isClaudeCommand("claudette"))
    }

    // MARK: - Quoting

    func testAnOpeningTurnWithAnApostropheIsQuotedSafely() {
        let q = AgentLaunch.quote("don't break this")
        XCTAssertEqual(q, "'don'\\''t break this'")
    }

    func testAMultiLineBriefKeepsItsIndentation() {
        // Nothing rewrites the turn, and quoting preserves it verbatim — a briefing
        // with an indented list used to come out flattened.
        let brief = "Rebuild the footer:\n  - newsletter form\n  - social links"
        let launch = ProjectAgent.childLaunch(initialPrompt: brief)
        XCTAssertEqual(launch.openingTurn, brief)
        XCTAssertTrue(AgentLaunch.quote(brief).contains("\n  - newsletter form"))
    }

    // MARK: - The builders keep flags and turn apart

    func testTheCoordinatorsGuideIsAFlagAndItsCommandIsTheOpeningTurn() {
        let launch = ProjectAgent.launch()
        XCTAssertEqual(launch.openingTurn, "/project-agent")
        // The command legitimately *mentions* project-agent — the guide it cats
        // lives at .../skills/project-agent/SKILL.md — so the check is that the
        // quoted positional isn't baked in, not that the substring is absent.
        XCTAssertFalse(launch.command.contains("'/project-agent'"),
                       "the opening turn must not be baked into the command: \(launch.command)")
    }

    func testTheServiceHatchKeepsItsGuideAsTheOpeningTurn() {
        let launch = ServiceHatch.launch()
        XCTAssertEqual(launch.openingTurn, "/idealize-service-hatch")
        XCTAssertFalse(launch.command.contains("/idealize-service-hatch"))
    }

    func testAnEmptyOrWhitespaceBriefYieldsNoOpeningTurn() {
        XCTAssertNil(ProjectAgent.childLaunch(initialPrompt: nil).openingTurn)
        XCTAssertNil(ProjectAgent.childLaunch(initialPrompt: "   \n ").openingTurn)
    }
}
