import XCTest
@testable import IDEalizeApp

final class IDEalizeTerminalViewTests: XCTestCase {
    private let enter = Array("\u{1B}[?1049h".utf8)
    private let leave = Array("\u{1B}[?1049l".utf8)

    func testContainsAlternateScreenSequenceAtEveryPosition() {
        XCTAssertTrue(IDEalizeTerminalView.contains(ArraySlice(enter + [0x78]), enter))
        XCTAssertTrue(IDEalizeTerminalView.contains(ArraySlice([0x78] + enter + [0x79]), enter))
        XCTAssertTrue(IDEalizeTerminalView.contains(ArraySlice([0x78] + leave), leave))
    }

    func testContainsSequenceWithNonzeroSliceIndices() {
        let bytes = [0x70, 0x71] + enter + [0x72, 0x73]
        let slice = bytes[2..<(2 + enter.count)]

        XCTAssertEqual(slice.startIndex, 2)
        XCTAssertTrue(IDEalizeTerminalView.contains(slice, enter))
    }

    func testDoesNotMatchAbsentOrPartialSequence() {
        XCTAssertFalse(IDEalizeTerminalView.contains(ArraySlice([0x78, 0x79, 0x7A]), enter))
        XCTAssertFalse(IDEalizeTerminalView.contains(ArraySlice(enter.dropLast()), enter))

        var nearMatch = enter
        nearMatch[nearMatch.count - 1] = 0x6C
        XCTAssertFalse(IDEalizeTerminalView.contains(ArraySlice(nearMatch), enter))
    }
}
