import Foundation
import XCTest
@testable import IDEalizeApp

final class ShellIntegrationParserTests: XCTestCase {
    func testParsesBELAndStringTerminatedFrames() {
        let parser = ShellIntegrationParser()
        let stream = [
            marker("event=exec;cmd=\(base64("swift test"));cwd=\(base64("/tmp/project"))", terminator: "\u{07}"),
            marker("event=done;exit=-2", terminator: "\u{1B}\\"),
        ].joined()

        let events = parser.consume(Array(stream.utf8)[...])
        XCTAssertEqual(events.count, 2)
        guard case .exec(let command, let cwd) = events[0] else {
            return XCTFail("expected exec event")
        }
        XCTAssertEqual(command, "swift test")
        XCTAssertEqual(cwd, "/tmp/project")
        guard case .done(let exitCode) = events[1] else {
            return XCTFail("expected done event")
        }
        XCTAssertEqual(exitCode, -2)
    }

    func testParsesFrameSplitAcrossIndividualBytes() {
        let parser = ShellIntegrationParser()
        let bytes = Array(marker("event=exec;cmd=\(base64("echo split"))", terminator: "\u{07}").utf8)
        var events: [ShellEvent] = []

        for byte in bytes {
            events.append(contentsOf: parser.consume([byte][...]))
        }

        XCTAssertEqual(events.count, 1)
        guard case .exec(let command, _) = events[0] else {
            return XCTFail("expected exec event")
        }
        XCTAssertEqual(command, "echo split")
    }

    func testRejectsExecWithMissingOrInvalidBase64Command() {
        let parser = ShellIntegrationParser()
        let stream = [
            marker("event=exec", terminator: "\u{07}"),
            marker("event=exec;cmd=not-base64!", terminator: "\u{1B}\\"),
        ].joined()

        XCTAssertTrue(parser.consume(Array(stream.utf8)[...]).isEmpty)
    }

    func testRejectsInvalidUTF8MarkerPayloadAndDecodedCommand() {
        let parser = ShellIntegrationParser()
        let prefix = Array("\u{1B}]1771;".utf8)
        let invalidPayload = prefix + [0xFF, 0x07]
        let invalidCommand = marker(
            "event=exec;cmd=\(Data([0xFF]).base64EncodedString())",
            terminator: "\u{07}")
        let bytes = invalidPayload + Array(invalidCommand.utf8)

        XCTAssertTrue(parser.consume(bytes[...]).isEmpty)
    }

    func testRejectsDoneWithMissingNonNumericOrOutOfRangeExitStatus() {
        let parser = ShellIntegrationParser()
        let stream = [
            marker("event=done", terminator: "\u{07}"),
            marker("event=done;exit=not-a-number", terminator: "\u{07}"),
            marker("event=done;exit=2147483648", terminator: "\u{07}"),
            marker("event=done;exit=-2147483649", terminator: "\u{1B}\\"),
        ].joined()

        XCTAssertTrue(parser.consume(Array(stream.utf8)[...]).isEmpty)
    }

    func testVeryLargeIncompleteMarkerOverChunksDiscardsUntilBELThenRecovers() {
        let parser = ShellIntegrationParser()
        let start = Array("\u{1B}]1771;event=exec;cmd=".utf8)
        XCTAssertTrue(parser.consume(start[...]).isEmpty)

        let chunk = Array(repeating: UInt8(ascii: "A"), count: 32 * 1024)
        for _ in 0..<64 {
            XCTAssertTrue(parser.consume(chunk[...]).isEmpty)
        }

        // Marker-looking bytes inside the oversized frame must stay discarded;
        // the BEL below terminates the outer frame rather than this nested text.
        let nestedMarkerText = Array("\u{1B}]1771;event=done;exit=99".utf8)
        XCTAssertTrue(parser.consume(nestedMarkerText[...]).isEmpty)

        let recovery = [UInt8(0x07)] + Array(marker("event=done;exit=0", terminator: "\u{07}").utf8)
        let events = parser.consume(recovery[...])
        XCTAssertEqual(events.count, 1)
        guard case .done(let exitCode) = events[0] else {
            return XCTFail("expected done event")
        }
        XCTAssertEqual(exitCode, 0)
    }

    func testVeryLargeCompleteMarkerInOneCallbackIsDiscardedAndFollowingFrameParses() {
        let parser = ShellIntegrationParser()
        var bytes = Array("\u{1B}]1771;event=exec;cmd=".utf8)
        bytes.append(contentsOf: repeatElement(UInt8(ascii: "A"), count: 2 * 1024 * 1024))
        bytes.append(0x07)
        bytes.append(contentsOf: marker("event=done;exit=7", terminator: "\u{1B}\\").utf8)

        let events = parser.consume(bytes[...])
        XCTAssertEqual(events.count, 1)
        guard case .done(let exitCode) = events[0] else {
            return XCTFail("expected done event")
        }
        XCTAssertEqual(exitCode, 7)
    }

    func testSplitStringTerminatorWhileDiscardingThenRecovers() {
        let parser = ShellIntegrationParser()
        var oversizedStart = Array("\u{1B}]1771;event=exec;cmd=".utf8)
        oversizedStart.append(contentsOf: repeatElement(UInt8(ascii: "A"), count: 32 * 1024))
        XCTAssertTrue(parser.consume(oversizedStart[...]).isEmpty)

        XCTAssertTrue(parser.consume([0x1B][...]).isEmpty)
        let recovery = [UInt8(0x5C)] + Array(marker("event=done;exit=9", terminator: "\u{07}").utf8)
        let events = parser.consume(recovery[...])

        XCTAssertEqual(events.count, 1)
        guard case .done(let exitCode) = events[0] else {
            return XCTFail("expected done event")
        }
        XCTAssertEqual(exitCode, 9)
    }

    func testExact16KiBBoundaryIsAcceptedAndOneByteOverIsDiscarded() {
        let prefix = Array("\u{1B}]1771;".utf8)
        let basePayload = Array("event=exec;cmd=\(base64("boundary"));pad=".utf8)
        let exactPayloadSize = 16 * 1024 - prefix.count - 1 // BEL terminator
        XCTAssertLessThan(basePayload.count, exactPayloadSize)

        var exact = prefix + basePayload
        exact.append(contentsOf: repeatElement(
            UInt8(ascii: "A"),
            count: exactPayloadSize - basePayload.count))
        exact.append(0x07)
        XCTAssertEqual(exact.count, 16 * 1024)

        let exactEvents = ShellIntegrationParser().consume(exact[...])
        XCTAssertEqual(exactEvents.count, 1)
        guard case .exec(let command, _) = exactEvents[0] else {
            return XCTFail("expected exact-boundary exec event")
        }
        XCTAssertEqual(command, "boundary")

        var oversized = prefix + basePayload
        oversized.append(contentsOf: repeatElement(
            UInt8(ascii: "A"),
            count: exactPayloadSize - basePayload.count + 1))
        oversized.append(0x07)
        oversized.append(contentsOf: marker("event=done;exit=11", terminator: "\u{07}").utf8)

        let recoveryEvents = ShellIntegrationParser().consume(oversized[...])
        XCTAssertEqual(recoveryEvents.count, 1)
        guard case .done(let exitCode) = recoveryEvents[0] else {
            return XCTFail("expected recovery event after oversized boundary")
        }
        XCTAssertEqual(exitCode, 11)
    }

    private func marker(_ payload: String, terminator: String) -> String {
        "\u{1B}]1771;\(payload)\(terminator)"
    }

    private func base64(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
    }
}
