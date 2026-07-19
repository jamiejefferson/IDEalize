import Foundation
import AppKit

/// A "block": one command, its rendered output, and metadata — à la Warp.
struct CommandBlock: Identifiable {
    let id = UUID()
    var command: String
    var cwd: String?
    var startedAt: Date
    var finishedAt: Date?
    var exitCode: Int32?
    /// Rendered, colored output (nil while running or for interactive sessions).
    var output: NSAttributedString?
    var outputLineCount: Int = 0
    /// True if the command ran a full-screen (alternate-buffer) program.
    var interactive: Bool = false

    var isRunning: Bool { finishedAt == nil }
    var succeeded: Bool? { exitCode.map { $0 == 0 } }
    var plainOutput: String { output?.string ?? "" }

    var duration: TimeInterval? {
        guard let finishedAt else { return nil }
        return finishedAt.timeIntervalSince(startedAt)
    }
}

/// Events decoded from the shell-integration OSC stream.
enum ShellEvent {
    case prompt(cwd: String?)
    case exec(command: String, cwd: String?)
    case done(exitCode: Int32)
}

/// Scans a raw PTY byte stream for IDEalize's custom OSC 1771 markers and emits
/// `ShellEvent`s. Tolerates sequences split across reads via a small carry.
final class ShellIntegrationParser {
    private var carry: [UInt8] = []
    private let maxCarry = 16 * 1024

    private static let ESC: UInt8 = 0x1B
    private static let BEL: UInt8 = 0x07
    private static let BACKSLASH: UInt8 = 0x5C
    // "]1771;"
    private static let prefix: [UInt8] = Array("\u{1B}]1771;".utf8)

    /// True while a partial sequence is buffered waiting for its remainder.
    /// Callers can skip `consume` for chunks that neither contain an ESC byte
    /// nor could complete a carried marker.
    var hasPendingCarry: Bool { !carry.isEmpty }

    /// Feed bytes; returns any complete events found.
    func consume(_ bytes: ArraySlice<UInt8>) -> [ShellEvent] {
        var buffer = carry
        buffer.append(contentsOf: bytes)
        carry.removeAll(keepingCapacity: true)

        var events: [ShellEvent] = []
        var i = 0
        let n = buffer.count

        while i < n {
            // Find next ESC.
            guard let escIdx = nextIndex(of: Self.ESC, in: buffer, from: i) else {
                break // no ESC; nothing pending to carry
            }
            // Do we have enough bytes to test the prefix?
            if escIdx + Self.prefix.count > n {
                // Possible partial prefix — carry from here.
                carry = Array(buffer[escIdx...])
                trimCarry()
                return events
            }
            // Check prefix match.
            if !matchesPrefix(buffer, at: escIdx) {
                i = escIdx + 1
                continue
            }
            // Find terminator: BEL, or ESC '\'.
            let payloadStart = escIdx + Self.prefix.count
            guard let termIdx = terminator(in: buffer, from: payloadStart) else {
                // Incomplete sequence — carry from ESC.
                carry = Array(buffer[escIdx...])
                trimCarry()
                return events
            }
            let payload = Array(buffer[payloadStart..<termIdx.start])
            if let event = parsePayload(payload) { events.append(event) }
            i = termIdx.end
        }
        return events
    }

    // MARK: - Helpers

    private func nextIndex(of byte: UInt8, in buf: [UInt8], from: Int) -> Int? {
        var j = from
        while j < buf.count { if buf[j] == byte { return j }; j += 1 }
        return nil
    }

    private func matchesPrefix(_ buf: [UInt8], at idx: Int) -> Bool {
        for (k, b) in Self.prefix.enumerated() where buf[idx + k] != b { return false }
        return true
    }

    /// Returns the terminator range (start = first terminator byte, end = index
    /// after the full terminator).
    private func terminator(in buf: [UInt8], from: Int) -> (start: Int, end: Int)? {
        var j = from
        while j < buf.count {
            if buf[j] == Self.BEL { return (j, j + 1) }
            if buf[j] == Self.ESC, j + 1 < buf.count, buf[j + 1] == Self.BACKSLASH {
                return (j, j + 2)
            }
            j += 1
        }
        return nil
    }

    private func trimCarry() {
        if carry.count > maxCarry { carry.removeAll(keepingCapacity: true) }
    }

    private func parsePayload(_ payload: [UInt8]) -> ShellEvent? {
        let str = String(decoding: payload, as: UTF8.self)
        var fields: [String: String] = [:]
        for pair in str.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { fields[kv[0]] = kv[1] }
        }
        func decode(_ key: String) -> String? {
            guard let v = fields[key], let data = Data(base64Encoded: v) else { return nil }
            return String(decoding: data, as: UTF8.self)
        }
        switch fields["event"] {
        case "prompt":
            return .prompt(cwd: decode("cwd"))
        case "exec":
            return .exec(command: decode("cmd") ?? "", cwd: decode("cwd"))
        case "done":
            return .done(exitCode: Int32(fields["exit"] ?? "0") ?? 0)
        default:
            return nil
        }
    }
}
