import AppKit
import XCTest
@testable import IDEalizeApp

/// The recolour sits on every byte the terminal receives, so the bar is not just
/// "the rules come out the right colour" but "nothing else is disturbed": the
/// text between them survives byte for byte, and a character split across a read
/// boundary still lands whole.
final class BoxDrawingRecolourTests: XCTestCase {
    private let red = NSColor(srgbRed: 1, green: 0, blue: 0, alpha: 1)
    private var setRed: [UInt8] { Array("\u{1B}[38;2;255;0;0m".utf8) }
    private var reset: [UInt8] { Array("\u{1B}[39m".utf8) }

    private func bytes(_ string: String) -> [UInt8] { Array(string.utf8) }

    func testPassesThroughWhenNoColourIsSet() {
        var recolour = BoxDrawingRecolour()
        XCTAssertNil(recolour.process(bytes("───")[...]))
    }

    func testPassesThroughChunksWithoutBoxDrawing() {
        var recolour = BoxDrawingRecolour(color: red)
        // The fast path: no 0xE2 lead byte, so no work and no allocation.
        XCTAssertNil(recolour.process(bytes("plain output\n")[...]))
    }

    func testWrapsARunOnceRatherThanPerCharacter() {
        var recolour = BoxDrawingRecolour(color: red)
        let out = recolour.process(bytes("───")[...])
        XCTAssertEqual(out, setRed + bytes("───") + reset)
    }

    func testLeavesSurroundingTextUntouched() {
        var recolour = BoxDrawingRecolour(color: red)
        let out = recolour.process(bytes("a──b")[...])
        XCTAssertEqual(out, bytes("a") + setRed + bytes("──") + reset + bytes("b"))
    }

    func testIgnoresOtherCharactersInTheSameUTF8Range() {
        // Em dash (E2 80 94) and a right arrow (E2 86 92) share the 0xE2 lead
        // byte with the box-drawing block but are text, not chrome.
        var recolour = BoxDrawingRecolour(color: red)
        let out = recolour.process(bytes("— →")[...])
        XCTAssertEqual(out, bytes("— →"))
    }

    func testCarriesACharacterSplitAcrossChunks() {
        var recolour = BoxDrawingRecolour(color: red)
        let rule = bytes("──")            // E2 94 80 E2 94 80
        let first = recolour.process(rule[0..<4])   // ends mid-sequence
        let second = recolour.process(rule[4...])
        // The split character is held back, so nothing is emitted uncoloured…
        XCTAssertEqual(first, setRed + Array(rule[0..<3]) + reset)
        // …and arrives, whole and coloured, with the next chunk.
        XCTAssertEqual(second, setRed + Array(rule[3...]) + reset)
    }

    func testPreservesEveryOriginalByteInOrder() {
        var recolour = BoxDrawingRecolour(color: red)
        let input = bytes("┌─ hi ─┐\nbody\n└──────┘\n")
        var emitted: [UInt8] = []
        // Feed it in awkward 5-byte chunks so sequences straddle boundaries.
        for start in stride(from: 0, to: input.count, by: 5) {
            let chunk = input[start..<min(start + 5, input.count)]
            emitted += recolour.process(chunk) ?? Array(chunk)
        }
        // Strip the SGR runs we inserted; what's left must be the input exactly.
        var stripped: [UInt8] = []
        var index = 0
        while index < emitted.count {
            if Array(emitted[index...].prefix(setRed.count)) == setRed {
                index += setRed.count
            } else if Array(emitted[index...].prefix(reset.count)) == reset {
                index += reset.count
            } else {
                stripped.append(emitted[index])
                index += 1
            }
        }
        XCTAssertEqual(stripped, input)
    }

    func testNeverLeavesTheColourSetAcrossAChunkBoundary() {
        var recolour = BoxDrawingRecolour(color: red)
        let out = recolour.process(bytes("──")[...]) ?? []
        // A chunk ending inside a run still closes it, so text arriving in the
        // next chunk can't inherit the rule colour.
        XCTAssertEqual(Array(out.suffix(reset.count)), reset)
    }
}
