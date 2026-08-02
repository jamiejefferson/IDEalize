import XCTest
@testable import IDEalizeApp

/// The document panel's heading outline is only as good as what it counts as a
/// heading: every false positive is a row that jumps somewhere meaningless, and
/// every miss is a section the reader can't reach.
final class MarkdownOutlineTests: XCTestCase {

    func testCapturesLevelsTitlesAndLineNumbers() {
        let doc = """
        # Top
        body
        ## Middle
        ### Deep
        """
        let headings = MarkdownOutline.parse(doc).headings
        XCTAssertEqual(headings.map(\.level), [1, 2, 3])
        XCTAssertEqual(headings.map(\.title), ["Top", "Middle", "Deep"])
        // The line index is what the editor scrolls to, so it must be exact.
        XCTAssertEqual(headings.map(\.lineIndex), [0, 2, 3])
    }

    /// A shell snippet's comments are the most common thing in these documents
    /// that looks like a heading and isn't.
    func testIgnoresHashesInsideFencedCodeBlocks() {
        let doc = """
        # Real Heading
        ```bash
        # install deps
        ## not a heading either
        ```
        ## Also Real
        """
        let headings = MarkdownOutline.parse(doc).headings
        XCTAssertEqual(headings.map(\.title), ["Real Heading", "Also Real"])
    }

    func testTildeFencesAlsoHideHeadings() {
        let doc = """
        ~~~
        # hidden
        ~~~
        # Visible
        """
        XCTAssertEqual(MarkdownOutline.parse(doc).headings.map(\.title), ["Visible"])
    }

    /// A longer fence is closed only by one at least as long, so a nested
    /// shorter fence must not end the block early.
    func testLongerFenceIsNotClosedByAShorterOne() {
        let doc = """
        ````
        ```
        # still inside
        ```
        ````
        # Outside
        """
        XCTAssertEqual(MarkdownOutline.parse(doc).headings.map(\.title), ["Outside"])
    }

    func testRequiresASpaceAfterTheHashes() {
        // "#tag" is a tag, not a heading.
        XCTAssertTrue(MarkdownOutline.parse("#tag\n#hashtag").headings.isEmpty)
    }

    func testAllowsUpToThreeLeadingSpacesButNotFour() {
        let doc = """
           # Indented three
            # Indented four
        """
        XCTAssertEqual(MarkdownOutline.parse(doc).headings.map(\.title), ["Indented three"])
    }

    func testStopsAtSixHashes() {
        let doc = """
        ###### Six
        ####### Seven
        """
        XCTAssertEqual(MarkdownOutline.parse(doc).headings.map(\.title), ["Six"])
    }

    func testStripsAClosingHashSequence() {
        XCTAssertEqual(MarkdownOutline.parse("## Title ##").headings.first?.title, "Title")
        // Hashes that aren't a closing sequence stay part of the title.
        XCTAssertEqual(MarkdownOutline.parse("## C# notes").headings.first?.title, "C# notes")
    }

    func testHandlesEmptyDocument() {
        XCTAssertTrue(MarkdownOutline.parse("").headings.isEmpty)
    }
}
