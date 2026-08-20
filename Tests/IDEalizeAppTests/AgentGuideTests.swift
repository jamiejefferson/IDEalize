import XCTest
@testable import IDEalizeApp

/// The guides are injected as system prompts on every agent launch and every
/// restore, so their size is a recurring cost paid per agent, per restart. These
/// checks keep the always-on core lean and make sure the deferred procedures are
/// actually reachable — a reference the agent can't find is worse than no split.
final class AgentGuideTests: XCTestCase {

    /// Read a bundled guide file from the source tree (tests run from the repo root).
    private func bundled(_ relPath: String) throws -> String {
        let url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("Resources/FlowSkills/skills").appendingPathComponent(relPath)
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// The guides are hard-wrapped prose, so a phrase can straddle a line break.
    /// Collapse whitespace before asserting a rule survived, or the test is really
    /// checking where the paragraph happened to wrap.
    private func prose(_ relPath: String) throws -> String {
        try bundled(relPath).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    // MARK: - The cores stay lean

    func testTheProjectAgentCoreStaysWellUnderItsOldSize() throws {
        let core = try bundled("project-agent/SKILL.md")
        XCTAssertLessThan(core.count, 16_000,
                          "the always-on core has grown back toward the 22.8KB original")
    }

    func testTheLeadAgentCoreStaysLean() throws {
        let core = try bundled("lead-agent/SKILL.md")
        XCTAssertLessThan(core.count, 11_000)
    }

    // MARK: - Every reference the app installs exists, and every one is named

    func testEveryProjectAgentReferenceIsBundled() throws {
        for name in FlowSkillInstaller.projectAgentReferences {
            XCTAssertFalse(try bundled("project-agent/\(name)").isEmpty, "\(name) is empty")
        }
    }

    func testEveryLeadAgentReferenceIsBundled() throws {
        for name in FlowSkillInstaller.leadAgentReferences {
            XCTAssertFalse(try bundled("lead-agent/\(name)").isEmpty, "\(name) is empty")
        }
    }

    /// A reference nobody is told to read is dead weight; a reference named in the
    /// guide but never installed sends the agent looking for a file that isn't there.
    func testTheGuidesAndTheInstallerAgreeOnTheReferenceSet() throws {
        let projectCore = try prose("project-agent/SKILL.md")
        for name in FlowSkillInstaller.projectAgentReferences {
            XCTAssertTrue(projectCore.contains(name), "project-agent guide never mentions \(name)")
        }
        let leadCore = try prose("lead-agent/SKILL.md")
        for name in FlowSkillInstaller.leadAgentReferences {
            XCTAssertTrue(leadCore.contains(name), "lead-agent guide never mentions \(name)")
        }
    }

    // MARK: - The rules that had to survive the rewrite

    func testBothGuidesCarryTheCostRules() throws {
        for guide in ["project-agent/SKILL.md", "lead-agent/SKILL.md"] {
            let text = try prose(guide)
            XCTAssertTrue(text.contains("turn count is the bill"), "\(guide) lost the cost rules")
            XCTAssertTrue(text.contains("only announce intent"), "\(guide) lost the no-announce rule")
        }
    }

    func testBothGuidesTeachTheSameWireVocabulary() throws {
        for guide in ["project-agent/SKILL.md", "lead-agent/SKILL.md"] {
            let text = try prose(guide)
            XCTAssertTrue(text.contains("idealize rung"), "\(guide) doesn't teach the rung verb")
            XCTAssertTrue(text.contains("waiting-on-lead"), "\(guide) lost the blocker vocabulary")
            XCTAssertTrue(text.contains("not a story") || text.contains("rungs, blockers"),
                          "\(guide) lost the no-stories rule")
        }
    }

    /// The board file is the thing that grew to 27KB and got re-read whole. Both
    /// guides have to carry a budget, or it just grows back.
    func testBothGuidesCapTheirBoard() throws {
        XCTAssertTrue(try prose("project-agent/SKILL.md").contains("under 150 lines"))
        XCTAssertTrue(try prose("lead-agent/SKILL.md").contains("under 80 lines"))
    }

    func testTheProjectAgentIsToldNotToRetellTheProjectInBriefs() throws {
        let core = try prose("project-agent/SKILL.md")
        XCTAssertTrue(core.contains("point at them") || core.contains("instead of retelling"),
                      "briefs must point at the board rather than restate it")
    }

    // MARK: - The reference note the app appends

    /// It is spliced into a shell command, so a newline would submit the command
    /// early and a `$` would expand.
    func testTheReferenceNoteIsASafeSingleLine() {
        for lead in [true, false] {
            let note = ProjectAgent.referenceNote(forLead: lead)
            XCTAssertFalse(note.contains("\n"), "the note must not break the command line")
            XCTAssertFalse(note.contains("\""), "an unescaped quote would end the shell string")
        }
    }

    func testTheReferenceNoteNamesEveryFileAndTheirFolder() {
        let note = ProjectAgent.referenceNote(forLead: false)
        for name in FlowSkillInstaller.projectAgentReferences {
            XCTAssertTrue(note.contains(name), "the agent is never told about \(name)")
        }
        XCTAssertTrue(note.contains(FlowSkillInstaller.referenceDir(forLead: false).lastPathComponent))
    }

    /// The two guides land in different folders in a dev build; their references
    /// must not collide, or one set silently overwrites the other.
    func testLeadAndProjectReferencesNeverShareADirectory() {
        XCTAssertNotEqual(FlowSkillInstaller.referenceDir(forLead: true),
                          FlowSkillInstaller.referenceDir(forLead: false))
    }
}
