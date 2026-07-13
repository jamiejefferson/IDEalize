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
/// `ShellEvent`s. Tolerates sequences split across reads while retaining at most
/// one bounded marker payload.
final class ShellIntegrationParser {
    private enum Mode {
        case scanning
        case collecting
        case discarding
    }

    private var mode: Mode = .scanning
    private var prefixMatchCount = 0
    private var markerPayload: [UInt8] = []
    /// Bytes consumed for the current marker, including its prefix but excluding
    /// the current callback byte until that byte is accepted.
    private var markerSize = 0
    /// In collecting mode this means the last retained payload byte was ESC. In
    /// discard mode it remembers a possible ST terminator across callbacks.
    private var sawEscape = false
    private let maxMarkerSize = 16 * 1024

    private static let ESC: UInt8 = 0x1B
    private static let BEL: UInt8 = 0x07
    private static let BACKSLASH: UInt8 = 0x5C
    // "]1771;"
    private static let prefix: [UInt8] = Array("\u{1B}]1771;".utf8)

    /// Feed bytes; returns any complete events found.
    func consume(_ bytes: ArraySlice<UInt8>) -> [ShellEvent] {
        var events: [ShellEvent] = []
        for byte in bytes {
            switch mode {
            case .scanning:
                scan(byte)
            case .collecting:
                if let event = collect(byte) { events.append(event) }
            case .discarding:
                discard(byte)
            }
        }
        return events
    }

    /// Match the marker prefix without retaining the input bytes. The prefix has
    /// no self-overlap except its initial ESC, so a mismatching ESC starts a new
    /// candidate and every other mismatch returns to zero.
    private func scan(_ byte: UInt8) {
        if byte == Self.prefix[prefixMatchCount] {
            prefixMatchCount += 1
            if prefixMatchCount == Self.prefix.count {
                mode = .collecting
                prefixMatchCount = 0
                markerPayload.removeAll(keepingCapacity: true)
                markerSize = Self.prefix.count
                sawEscape = false
            }
        } else {
            prefixMatchCount = byte == Self.ESC ? 1 : 0
        }
    }

    private func collect(_ byte: UInt8) -> ShellEvent? {
        // BEL always terminates the marker, including when the preceding payload
        // byte happened to be ESC.
        if byte == Self.BEL {
            return finishMarker(removingTrailingEscape: false)
        }

        // The ESC was retained provisionally. A following backslash makes it the
        // two-byte ST terminator, so remove it before decoding the payload.
        if sawEscape, byte == Self.BACKSLASH {
            return finishMarker(removingTrailingEscape: true)
        }

        // A legal marker still needs at least one terminator byte. As soon as the
        // current non-terminator would leave no room, drop all retained storage
        // and ignore the frame until its real BEL/ST terminator arrives.
        guard markerSize + 1 < maxMarkerSize else {
            beginDiscarding(sawEscape: byte == Self.ESC)
            return nil
        }

        markerPayload.append(byte)
        markerSize += 1
        sawEscape = byte == Self.ESC
        return nil
    }

    private func finishMarker(removingTrailingEscape: Bool) -> ShellEvent? {
        // The current BEL or trailing backslash adds one byte. (For ST, its ESC
        // is already included in markerSize.)
        guard markerSize + 1 <= maxMarkerSize else {
            resetAfterOversizedMarker()
            return nil
        }

        if removingTrailingEscape { markerPayload.removeLast() }
        let event = parsePayload(markerPayload)
        resetAfterCompleteMarker()
        return event
    }

    private func beginDiscarding(sawEscape: Bool) {
        mode = .discarding
        markerPayload.removeAll(keepingCapacity: false)
        markerSize = 0
        self.sawEscape = sawEscape
    }

    /// Discard without storing bytes. Marker-looking content is deliberately not
    /// scanned here: only the oversized frame's actual BEL/ST can resume parsing.
    private func discard(_ byte: UInt8) {
        if byte == Self.BEL || (sawEscape && byte == Self.BACKSLASH) {
            mode = .scanning
            prefixMatchCount = 0
            sawEscape = false
            return
        }
        sawEscape = byte == Self.ESC
    }

    private func resetAfterCompleteMarker() {
        mode = .scanning
        prefixMatchCount = 0
        markerPayload.removeAll(keepingCapacity: true)
        markerSize = 0
        sawEscape = false
    }

    private func resetAfterOversizedMarker() {
        mode = .scanning
        prefixMatchCount = 0
        markerPayload.removeAll(keepingCapacity: false)
        markerSize = 0
        sawEscape = false
    }

    private func parsePayload(_ payload: [UInt8]) -> ShellEvent? {
        guard let str = String(bytes: payload, encoding: .utf8) else { return nil }
        var fields: [String: String] = [:]
        for pair in str.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { fields[kv[0]] = kv[1] }
        }
        func decode(_ key: String) -> String? {
            guard let v = fields[key], let data = Data(base64Encoded: v) else { return nil }
            return String(data: data, encoding: .utf8)
        }
        switch fields["event"] {
        case "prompt":
            return .prompt(cwd: decode("cwd"))
        case "exec":
            guard let command = decode("cmd") else { return nil }
            return .exec(command: command, cwd: decode("cwd"))
        case "done":
            guard let rawExit = fields["exit"], let exitCode = Int32(rawExit) else { return nil }
            return .done(exitCode: exitCode)
        default:
            return nil
        }
    }
}
