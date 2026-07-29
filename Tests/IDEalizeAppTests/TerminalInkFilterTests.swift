import AppKit
import XCTest
@testable import IDEalizeApp

/// The filter sits on every byte the terminal receives, so the bar isn't just
/// "the right things change colour" — it's that nothing else is disturbed. Text
/// survives byte for byte, sequences split across reads still land whole, and
/// escape payloads are never rewritten.
final class TerminalInkFilterTests: XCTestCase {
    private let paper = NSColor(srgbRed: 247 / 255, green: 245 / 255, blue: 240 / 255, alpha: 1)
    private let ink = NSColor(srgbRed: 42 / 255, green: 42 / 255, blue: 39 / 255, alpha: 1)
    private let rule = NSColor(srgbRed: 1, green: 0, blue: 0, alpha: 1)

    private func filter(dim: CGFloat? = nil, rules: Bool = true) -> TerminalInkFilter {
        var f = TerminalInkFilter()
        f.ruleColor = rules ? rule : nil
        f.dimBlend = dim
        f.background = paper
        f.foreground = ink
        f.palette = (0..<16).map { _ in ink }
        return f
    }

    private func bytes(_ s: String) -> [UInt8] { Array(s.utf8) }
    private var setRule: [UInt8] { bytes("\u{1B}[38;2;255;0;0m") }
    private var defaultFg: [UInt8] { bytes("\u{1B}[39m") }

    // MARK: Passthrough

    func testPassesThroughWhenNothingIsConfigured() {
        var f = filter(dim: nil, rules: false)
        XCTAssertNil(f.process(bytes("───")[...]))
    }

    func testPassesThroughPlainText() {
        var f = filter()
        XCTAssertNil(f.process(bytes("plain output\n")[...]))
    }

    // MARK: Rules

    func testWrapsARuleRunOnceRatherThanPerCharacter() {
        var f = filter()
        XCTAssertEqual(f.process(bytes("───")[...]), setRule + bytes("───") + defaultFg)
    }

    func testLeavesTextAroundARuleUntouched() {
        var f = filter()
        XCTAssertEqual(f.process(bytes("a──b")[...]),
                       bytes("a") + setRule + bytes("──") + defaultFg + bytes("b"))
    }

    func testIgnoresOtherCharactersSharingTheLeadByte() {
        // An em dash and an arrow are text, not chrome, despite the 0xE2 lead.
        var f = filter()
        XCTAssertEqual(f.process(bytes("— →")[...]), bytes("— →"))
    }

    func testRestoresTheColourTheProgramAskedForAfterARule() {
        var f = filter()
        let out = f.process(bytes("\u{1B}[31m──text")[...])
        // Back to red (31), not a blunt reset to the default foreground.
        XCTAssertEqual(out, bytes("\u{1B}[31m") + setRule + bytes("──")
                            + bytes("\u{1B}[31m") + bytes("text"))
    }

    func testCarriesACharacterSplitAcrossChunks() {
        var f = filter()
        let rules = bytes("──")
        XCTAssertEqual(f.process(rules[0..<4]), setRule + Array(rules[0..<3]) + defaultFg)
        XCTAssertEqual(f.process(rules[4...]), setRule + Array(rules[3...]) + defaultFg)
    }

    func testNeverLeavesTheRuleColourSetAcrossAChunkBoundary() {
        var f = filter()
        let out = f.process(bytes("──")[...]) ?? []
        XCTAssertEqual(Array(out.suffix(defaultFg.count)), defaultFg)
    }

    // MARK: Escape payloads

    func testDoesNotRewriteInsideAnOSCPayload() {
        // A window title holding a box-drawing character must survive intact —
        // injecting a colour into the payload would corrupt the sequence.
        var f = filter()
        let osc = bytes("\u{1B}]0;title ── here\u{07}after")
        XCTAssertEqual(f.process(osc[...]), osc)
    }

    func testResumesRewritingAfterAnOSCTerminatedByST() {
        var f = filter()
        let out = f.process(bytes("\u{1B}]0;t\u{1B}\\──")[...])
        XCTAssertEqual(out, bytes("\u{1B}]0;t\u{1B}\\") + setRule + bytes("──") + defaultFg)
    }

    func testLeavesNonSGRSequencesAlone() {
        var f = filter(dim: 0.22)
        let cursorMove = bytes("\u{1B}[2J\u{1B}[H")   // note the 2 that isn't dim
        XCTAssertEqual(f.process(cursorMove[...]), cursorMove)
    }

    // MARK: Dim

    func testSoftensDimToTheConfiguredBlend() {
        var f = filter(dim: 0.22, rules: false)
        // #999999 faded 22% toward the paper should land around #AEAEAE, rather
        // than the #C8C7C5 the terminal's own fixed half would give.
        let out = String(decoding: f.process(bytes("\u{1B}[38;2;153;153;153m\u{1B}[2mhi")[...]) ?? [],
                         as: UTF8.self)
        // The bare dim sequence is gone entirely — an empty `ESC[m` would read as
        // a full reset and wipe the colour it was meant to fade.
        XCTAssertFalse(out.contains("\u{1B}[m"), out)
        let channels = out.split(separator: "\u{1B}").last.map(String.init) ?? ""
        let numbers = channels.dropFirst(2).prefix(while: { $0 != "m" })
            .split(separator: ";").compactMap { Int($0) }
        XCTAssertEqual(numbers.count, 5, out)           // 38;2;r;g;b
        for channel in numbers.suffix(3) {
            XCTAssertEqual(channel, 174, accuracy: 2, out)
        }
    }

    func testDimOffRestoresTheProgramsOwnColour() {
        var f = filter(dim: 0.22, rules: false)
        let out = f.process(bytes("\u{1B}[31m\u{1B}[2mfaint\u{1B}[22mbold")[...]) ?? []
        // The explicit dim colour has to be undone, or "bold" would inherit it.
        XCTAssertTrue(String(decoding: out, as: UTF8.self).contains("faint\u{1B}[22m\u{1B}[31mbold"))
    }

    func testFullResetClearsDimWithoutAnExtraColour() {
        var f = filter(dim: 0.22, rules: false)
        let out = f.process(bytes("\u{1B}[2mfaint\u{1B}[0mplain")[...]) ?? []
        XCTAssertTrue(String(decoding: out, as: UTF8.self).hasSuffix("\u{1B}[0mplain"))
    }

    func testKeepsOtherAttributesInASharedSequence() {
        var f = filter(dim: 0.22, rules: false)
        let out = String(decoding: f.process(bytes("\u{1B}[1;2;4mx")[...]) ?? [], as: UTF8.self)
        // Bold and underline survive; only the dim parameter is taken out. What
        // follows is our own colour, so the check is on the attribute sequence
        // alone — a truecolor SGR legitimately contains a `2`.
        XCTAssertTrue(out.hasPrefix("\u{1B}[1;4m"), out)
        XCTAssertFalse(out.hasPrefix("\u{1B}[1;2;4m"), out)
    }

    func testLeavesDimAloneWhenNotConfigured() {
        var f = filter(dim: nil, rules: false)
        XCTAssertNil(f.process(bytes("\u{1B}[2mfaint")[...]))
    }

    // MARK: Whole-stream integrity

    func testPreservesEveryOriginalByteInOrder() {
        var f = filter(dim: 0.22)
        let input = bytes("\u{1B}[31m┌─ hi ─┐\u{1B}[0m\n\u{1B}[2mbody\u{1B}[22m\n└──────┘\n")
        var emitted: [UInt8] = []
        for start in stride(from: 0, to: input.count, by: 5) {   // awkward chunks
            let chunk = input[start..<min(start + 5, input.count)]
            emitted += f.process(chunk) ?? Array(chunk)
        }
        // Strip every SGR sequence from both sides: what's left is the content,
        // and it must be identical.
        func content(_ b: [UInt8]) -> [UInt8] {
            var out: [UInt8] = []
            var i = 0
            while i < b.count {
                if b[i] == 0x1B, i + 1 < b.count, b[i + 1] == UInt8(ascii: "[") {
                    var j = i + 2
                    while j < b.count, !(0x40...0x7E).contains(b[j]) { j += 1 }
                    i = j + 1
                    continue
                }
                out.append(b[i]); i += 1
            }
            return out
        }
        XCTAssertEqual(content(emitted), content(input))
    }
}
