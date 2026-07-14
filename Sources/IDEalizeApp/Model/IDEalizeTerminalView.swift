import Foundation
import SwiftTerm

/// LocalProcessTerminalView subclass that taps the PTY byte stream to extract
/// shell-integration events (block boundaries) and capture each command's raw
/// output bytes, before rendering normally.
final class IDEalizeTerminalView: LocalProcessTerminalView {
    private let parser = ShellIntegrationParser()

    /// prompt / exec events (block start, cwd updates).
    var onShellEvent: ((ShellEvent) -> Void)?
    /// Fired when a command finishes: its exit code, captured output bytes, and
    /// whether it used the alternate screen (a TUI).
    var onCommandFinished: ((_ exitCode: Int32, _ bytes: [UInt8], _ altScreen: Bool) -> Void)?
    /// Fired the instant a full-screen program enters or leaves the alternate
    /// screen (e.g. Claude Code / vim / top / less). This is the reliable signal
    /// the UI uses to give a TUI the whole pane — far more accurate than polling
    /// the foreground process group.
    var onAltScreenChanged: ((Bool) -> Void)?

    private var capturing = false
    private var captured: [UInt8] = []
    private var altScreenSeen = false
    private var inAltScreen = false
    private let maxCapture = 800_000

    // alt-screen enter / leave sequences.
    private static let altSeqs: [[UInt8]] = [
        Array("\u{1B}[?1049h".utf8), Array("\u{1B}[?1047h".utf8), Array("\u{1B}[?47h".utf8),
    ]
    private static let altLeaveSeqs: [[UInt8]] = [
        Array("\u{1B}[?1049l".utf8), Array("\u{1B}[?1047l".utf8), Array("\u{1B}[?47l".utf8),
    ]

    override func dataReceived(slice: ArraySlice<UInt8>) {
        let events = parser.consume(slice)

        // Track alternate-screen transitions live so the UI can hand the whole
        // pane to a TUI the moment it starts drawing.
        updateAltScreen(slice)

        // Capture output that arrives while a command is running.
        if capturing {
            if captured.count < maxCapture { captured.append(contentsOf: slice) }
            if !altScreenSeen, containsAltScreen(slice) { altScreenSeen = true }
        }

        for event in events {
            switch event {
            case .exec:
                capturing = true
                captured.removeAll(keepingCapacity: true)
                altScreenSeen = false
                forward(event)
            case .prompt:
                forward(event)
            case .done(let code):
                let bytes = captured
                let alt = altScreenSeen
                capturing = false
                let cb = onCommandFinished
                DispatchQueue.main.async { cb?(code, bytes, alt) }
            }
        }

        super.dataReceived(slice: slice)
    }

    /// Clear the visible scrollback and redraw the prompt (Ctrl-L) so completed
    /// output "graduates" into a block card without being shown twice.
    func clearViewport() {
        send(txt: "\u{0C}")
    }

    private func forward(_ event: ShellEvent) {
        let handler = onShellEvent
        DispatchQueue.main.async { handler?(event) }
    }

    /// Detect alternate-screen enter/leave within this chunk and notify on a
    /// genuine state change.
    private func updateAltScreen(_ slice: ArraySlice<UInt8>) {
        if !inAltScreen {
            if Self.altSeqs.contains(where: { contains(slice, $0) }) {
                inAltScreen = true
                let cb = onAltScreenChanged
                DispatchQueue.main.async { cb?(true) }
            }
        } else {
            if Self.altLeaveSeqs.contains(where: { contains(slice, $0) }) {
                inAltScreen = false
                let cb = onAltScreenChanged
                DispatchQueue.main.async { cb?(false) }
            }
        }
    }

    private func containsAltScreen(_ slice: ArraySlice<UInt8>) -> Bool {
        for seq in Self.altSeqs where contains(slice, seq) { return true }
        return false
    }

    /// Substring search over the slice in place — no `Array(slice)` copy. This runs
    /// on every PTY chunk, and a resize floods the PTY (SIGWINCH → full TUI repaint),
    /// so avoiding the copy matters exactly when it's hottest.
    private func contains(_ haystack: ArraySlice<UInt8>, _ needle: [UInt8]) -> Bool {
        let n = needle.count
        guard n > 0, haystack.count >= n else { return false }
        let last = haystack.endIndex - n
        var i = haystack.startIndex
        while i <= last {
            var match = true
            for j in 0..<n where haystack[i + j] != needle[j] { match = false; break }
            if match { return true }
            i += 1
        }
        return false
    }
}
