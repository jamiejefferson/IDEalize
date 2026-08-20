import XCTest
@testable import IDEalizeCore
@testable import IDEalizeApp

/// The wire between agents is supposed to carry rungs, blockers and questions — one
/// line each. These are the checks that make that a rule rather than an aspiration.
final class WireTests: XCTestCase {

    // MARK: - The cap

    func testAShortMessagePassesThroughUntouched() {
        let body = "Slate theme → saved — blocker: none"
        let (text, truncated) = Wire.clamp(body)
        XCTAssertEqual(text, body)
        XCTAssertFalse(truncated)
    }

    func testAMessageExactlyAtTheCapIsNotTrimmed() {
        let body = String(repeating: "x", count: Wire.maxBodyCharacters)
        let (text, truncated) = Wire.clamp(body)
        XCTAssertEqual(text.count, Wire.maxBodyCharacters)
        XCTAssertFalse(truncated)
    }

    func testAnEssayIsTrimmedAndSaysSo() {
        let body = String(repeating: "prose ", count: 400)   // 2400 characters
        XCTAssertGreaterThan(body.count, Wire.maxBodyCharacters)
        let (text, truncated) = Wire.clamp(body)
        XCTAssertTrue(truncated)
        XCTAssertTrue(text.hasSuffix(Wire.truncationNote),
                      "the receiver should see why the message stops")
        XCTAssertTrue(text.hasPrefix("prose"), "the start of the message survives")
        // Everything kept, plus the note explaining the cut.
        XCTAssertEqual(text.count, Wire.maxBodyCharacters + 1 + Wire.truncationNote.count)
    }

    /// A multi-line batched note — the thing the guides explicitly allow — has to fit.
    func testABatchedMultiLineStatusStillFits() {
        let batched = """
        [IDEalize] Slate theme → saved (t-abc123) — blocker: none
        [IDEalize] Service hatch discovery → checked (t-def456) — blocker: none
        [IDEalize] Lean agent guides → being-made (t-ghi789) — blocker: waiting-on-user
        """
        XCTAssertFalse(Wire.clamp(batched).truncated,
                       "three status lines must never hit the cap")
    }

    // MARK: - The vocabulary

    func testRungsAndBlockersAreNormalisedFromTheSpokenForm() {
        XCTAssertEqual(Wire.normalise("Being Made"), "being-made")
        XCTAssertEqual(Wire.normalise("  waiting on lead "), "waiting-on-lead")
        XCTAssertTrue(Wire.rungs.contains(Wire.normalise("being made")))
        XCTAssertTrue(Wire.blockers.contains(Wire.normalise("waiting on user")))
    }

    func testTheLadderIsInOrderAndStartsAndEndsWhereItShould() {
        XCTAssertEqual(Wire.rungs.first, "being-made")
        XCTAssertEqual(Wire.rungs.last, "closed")
        XCTAssertEqual(Wire.rungs.firstIndex(of: "saved")! ,
                       Wire.rungs.firstIndex(of: "preview")! + 1)
        XCTAssertLessThan(Wire.rungs.firstIndex(of: "checked")!,
                          Wire.rungs.firstIndex(of: "combined")!)
    }

    // MARK: - Notes stay fragments

    func testAShortNoteIsLeftAlone() {
        XCTAssertEqual(Wire.clampNote("needs a go/no-go"), "needs a go/no-go")
    }

    func testAMultiLineNoteIsFlattenedToOneLine() {
        let note = Wire.clampNote("first line\n\n  second line  \nthird")
        XCTAssertEqual(note, "first line second line third")
        XCTAssertFalse(note.contains("\n"))
    }

    /// The real case that prompted this: an agent explained its whole situation in
    /// the note, and it landed inside a "one line" status report.
    func testAParagraphNoteIsCutToAFragmentOnAWordBoundary() {
        let paragraph = "No .idealize/project-board.md exists in /private/tmp/wiredemo; "
            + "repo holds only a 3-byte readme.md and no commits. Nothing to infer piece A "
            + "from — asked the user for the spec."
        let note = Wire.clampNote(paragraph)
        XCTAssertLessThanOrEqual(note.count, Wire.maxNoteCharacters + 1)
        XCTAssertTrue(note.hasSuffix("…"))
        XCTAssertFalse(note.hasSuffix(" …"), "should cut on a word, not leave a dangling space")
    }

    /// Whatever a chat puts in the piece name and note, the report stays one line
    /// that fits the wire.
    func testAReportBuiltFromClampedPartsAlwaysFitsTheCap() {
        let piece = Wire.clampNote(String(repeating: "very long piece name ", count: 40))
        let note = Wire.clampNote(String(repeating: "explanation ", count: 100))
        let line = Wire.statusLine(project: "IDEalize", piece: piece, rung: "saved",
                                   blocker: "none", session: "t-abc123", note: note)
        XCTAssertFalse(line.contains("\n"))
        XCTAssertFalse(Wire.clamp(line).truncated)
    }

    // MARK: - The generated line

    func testTheStatusLineIsGeneratedInTheCanonicalShape() {
        let line = Wire.statusLine(project: "IDEalize", piece: "Slate theme",
                                   rung: "saved", blocker: "none",
                                   session: "t-abc123", note: nil)
        XCTAssertEqual(line, "[IDEalize] Slate theme → saved (t-abc123) — blocker: none")
    }

    func testTheStatusLineCarriesANoteWhenThereIsOne() {
        let line = Wire.statusLine(project: "IDEalize", piece: "Hatch",
                                   rung: "checked", blocker: "waiting-on-user",
                                   session: "t-1", note: "needs a go/no-go")
        XCTAssertEqual(line,
            "[IDEalize] Hatch → checked (t-1) — blocker: waiting-on-user — needs a go/no-go")
    }

    func testTheStatusLineDropsTheProjectAndSessionWhenAbsent() {
        let line = Wire.statusLine(project: nil, piece: "Hatch", rung: "live",
                                   blocker: "none", session: nil, note: nil)
        XCTAssertEqual(line, "Hatch → live — blocker: none")
    }

    /// Whatever else it carries, one report is one line — that's the whole point.
    func testAGeneratedStatusLineIsAlwaysOneLineAndFitsTheCap() {
        let line = Wire.statusLine(project: "A Rather Long Project Name",
                                   piece: String(repeating: "piece ", count: 20),
                                   rung: "combined", blocker: "waiting-on-lead",
                                   session: "t-abcdef", note: "a short note")
        XCTAssertFalse(line.contains("\n"))
        XCTAssertFalse(Wire.clamp(line).truncated)
    }

    // MARK: - The brief footer

    func testTheSpawnFooterPointsAtTheBoardRatherThanRetellingIt() {
        let footer = ProjectAgent.briefFooter(projectPath: "/tmp/demo")
        XCTAssertTrue(footer.contains("/tmp/demo/.idealize/project-board.md"))
        XCTAssertTrue(footer.contains("don't ask for it to be retold"))
        XCTAssertTrue(footer.contains("idealize rung"))
        XCTAssertTrue(footer.contains("turn count is the bill"))
    }

    func testAChatWithNoProjectGetsNoFooter() {
        let launch = ProjectAgent.childLaunch(initialPrompt: "Do the thing", projectPath: nil)
        XCTAssertEqual(launch.openingTurn, "Do the thing")
    }

    func testAProjectChatGetsTheBriefThenTheFooter() throws {
        let launch = ProjectAgent.childLaunch(initialPrompt: "Do the thing",
                                              projectPath: "/tmp/demo")
        let turn = try XCTUnwrap(launch.openingTurn)
        XCTAssertTrue(turn.hasPrefix("Do the thing"), "the coordinator's own brief stays first")
        XCTAssertTrue(turn.contains("project-board.md"))
    }

    /// An empty brief means the caller had nothing to say; appending house rules to
    /// nothing would be noise, not context.
    func testAnEmptyBriefStaysEmpty() {
        XCTAssertNil(ProjectAgent.childLaunch(initialPrompt: "   ",
                                              projectPath: "/tmp/demo").openingTurn)
    }
}
