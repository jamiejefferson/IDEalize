import AppKit
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

    /// Adjusts the ink of the incoming stream — the rules an agent frames its
    /// prompt box with, and how far dim text is faded. Configured from the theme.
    var ink = TerminalInkFilter()

    // MARK: - Dragging always selects, even while a TUI tracks the mouse

    /// Whether a plain left-button drag selects text even while the foreground
    /// program is tracking the mouse. Off restores SwiftTerm's stock behaviour
    /// (the program gets the drag, nothing is selected) — used by verification.
    var dragSelectsUnderMouseReporting = true

    /// True between mouse-down and mouse-up for a press this view took for
    /// selection rather than reporting onward.
    private var claimedPressForSelection = false
    /// Whether that press has moved far enough to be a drag rather than a click.
    private var pressBecameDrag = false

    /// Whether this event should select instead of being reported to the program.
    ///
    /// Claude Code turns on full mouse tracking (`?1000h ?1002h ?1003h ?1006h`),
    /// and SwiftTerm then hands every press and drag to it — so dragging across
    /// its output selected nothing at all. Shift bypasses reporting, but nobody
    /// discovers that, and selecting the agent's output is the whole point of
    /// this app. So a plain left drag belongs to selection; anything modified,
    /// and every other button, still reaches the program.
    private func pressBelongsToSelection(_ event: NSEvent) -> Bool {
        dragSelectsUnderMouseReporting && allowMouseReporting
            && getTerminal().mouseMode != .off
            && event.modifierFlags
                .intersection([.shift, .control, .option, .command]).isEmpty
    }

    /// Run `body` with mouse reporting off, so SwiftTerm takes its selection path.
    private func selecting(_ body: () -> Void) {
        let saved = allowMouseReporting
        allowMouseReporting = false
        body()
        allowMouseReporting = saved
    }

    override func mouseDown(with event: NSEvent) {
        claimedPressForSelection = pressBelongsToSelection(event)
        pressBecameDrag = false
        guard claimedPressForSelection else { return super.mouseDown(with: event) }
        selecting { super.mouseDown(with: event) }
    }

    override func mouseDragged(with event: NSEvent) {
        guard claimedPressForSelection else { return super.mouseDragged(with: event) }
        pressBecameDrag = true
        selecting { super.mouseDragged(with: event) }
    }

    override func mouseUp(with event: NSEvent) {
        guard claimedPressForSelection else { return super.mouseUp(with: event) }
        claimedPressForSelection = false
        selecting { super.mouseUp(with: event) }
        // A press that never moved was a click, not a selection: hand it to the
        // program after the fact so a TUI's clickable UI still works. Multi-click
        // is word/line selection and is never forwarded.
        guard !pressBecameDrag, event.clickCount == 1 else { return }
        forwardClick(at: event)
    }

    /// Send a left press + release at the event's cell to the foreground program.
    private func forwardClick(at event: NSEvent) {
        let terminal = getTerminal()
        let cols = max(terminal.cols, 1), rows = max(terminal.rows, 1)
        guard bounds.width > 0, bounds.height > 0 else { return }
        let p = convert(event.locationInWindow, from: nil)
        let col = min(max(0, Int(p.x / (bounds.width / CGFloat(cols)))), cols - 1)
        // The view is not flipped (y grows upward), so invert for the grid row.
        let row = min(max(0, Int((bounds.height - p.y) / (bounds.height / CGFloat(rows)))), rows - 1)
        for release in [false, true] {
            let flags = terminal.encodeButton(button: 0, release: release,
                                              shift: false, meta: false, control: false)
            terminal.sendEvent(buttonFlags: flags, x: col, y: row)
        }
    }

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

        if let recoloured = ink.process(slice) {
            super.dataReceived(slice: recoloured[...])
        } else {
            super.dataReceived(slice: slice)
        }
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
