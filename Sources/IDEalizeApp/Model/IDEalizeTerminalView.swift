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

    private static let ESC: UInt8 = 0x1B

    /// Alternate-screen enter/leave sequences, matched in one pass. Enter and
    /// leave share the `ESC [ ? …` prefix shape, so partial tails are carried
    /// between chunks (a sequence can straddle a read boundary).
    private static let altNeedles: [(seq: [UInt8], entering: Bool)] = {
        let enters = ["\u{1B}[?1049h", "\u{1B}[?1047h", "\u{1B}[?47h"]
        let leaves = ["\u{1B}[?1049l", "\u{1B}[?1047l", "\u{1B}[?47l"]
        return enters.map { (Array($0.utf8), true) } + leaves.map { (Array($0.utf8), false) }
    }()
    /// Tail of the previous chunk that is a prefix of an enter/leave sequence.
    /// Bounded by the longest needle minus one (8 bytes).
    private var altCarry: [UInt8] = []

    override func dataReceived(slice: ArraySlice<UInt8>) {
        let scan = scanAltSequences(slice)

        // Feed the shell-integration parser only when the chunk can contain (or
        // complete) a marker — most chunks carry no ESC byte, and consume()
        // copies the slice into its buffer.
        let events = (scan.sawESC || parser.hasPendingCarry) ? parser.consume(slice) : []

        // Alternate-screen transitions, applied in order so a chunk containing
        // both an enter and a leave lands on the right final state.
        for entering in scan.transitions {
            if capturing, entering { altScreenSeen = true }
            guard entering != inAltScreen else { continue }
            inAltScreen = entering
            let cb = onAltScreenChanged
            DispatchQueue.main.async { cb?(entering) }
        }

        // Capture output that arrives while a command is running (bounded).
        if capturing {
            let room = maxCapture - captured.count
            if room > 0 { captured.append(contentsOf: slice.prefix(room)) }
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

    /// Single pass over the (carried tail + new) bytes finding alt-screen
    /// enter/leave sequences. Returns whether any ESC byte was seen (cheap
    /// gate for the OSC parser) and the transitions found, in order.
    private func scanAltSequences(_ slice: ArraySlice<UInt8>) -> (sawESC: Bool, transitions: [Bool]) {
        var buffer = altCarry
        buffer.append(contentsOf: slice)
        altCarry.removeAll(keepingCapacity: true)

        var sawESC = false
        var transitions: [Bool] = []   // true = enter, false = leave
        var i = 0
        let n = buffer.count
        scan: while i < n {
            guard buffer[i] == Self.ESC else { i += 1; continue }
            sawESC = true
            for (seq, entering) in Self.altNeedles {
                let avail = n - i
                let cmp = min(avail, seq.count)
                var match = true
                for j in 0..<cmp where buffer[i + j] != seq[j] { match = false; break }
                guard match else { continue }
                if avail >= seq.count {
                    transitions.append(entering)
                    i += seq.count
                    continue scan
                }
                // Buffer tail is a prefix of this sequence — carry it into the
                // next chunk so split sequences still match, and stop scanning:
                // everything from here on is the carried tail.
                altCarry = Array(buffer[i...])
                break scan
            }
            i += 1
        }
        return (sawESC, transitions)
    }
}
