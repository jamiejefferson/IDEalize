import AppKit
import Foundation
import SwiftTerm

/// TEMPORARY verification harness for the terminal-selection fix. Drives a plain
/// drag across the grid and writes a PNG of the window, entirely in the
/// background — no focus is taken and no on-screen window is needed.
///
///   IDEALIZE_SELFTEST_SELECTION=synthetic  feed sample agent output, put the grid
///                                          into Claude Code's mouse-tracking mode
///   IDEALIZE_SELFTEST_SELECTION=claude     leave whatever the real agent printed
///   IDEALIZE_SELFTEST_NOFIX=1              stock SwiftTerm behaviour (shows the bug)
///   IDEALIZE_SELFTEST_OUT=<path>           result summary
///   IDEALIZE_SELFTEST_PNG=<path>           screenshot of the window
enum SelectionSelfTest {
    static func startIfRequested(workspace: Workspace) {
        let env = ProcessInfo.processInfo.environment
        let mode = env["IDEALIZE_SELFTEST_SELECTION"] ?? ""
        guard mode == "synthetic" || mode == "claude" else { return }
        let settle: Double = mode == "claude" ? 25 : 6
        DispatchQueue.main.asyncAfter(deadline: .now() + settle) {
            waitForGrid(workspace: workspace, mode: mode, attemptsLeft: 40)
        }
    }

    /// The grid attaches to its window lazily, and a restored rail rebuilds panes
    /// for a while after launch — so poll for a session that is actually on screen.
    private static func waitForGrid(workspace: Workspace, mode: String, attemptsLeft: Int) {
        guard let session = workspace.focusedSession, session.terminalView.window != nil else {
            guard attemptsLeft > 0 else { return write(env: "IDEALIZE_SELFTEST_OUT", "no grid on screen") }
            workspace.focusedSession?.revealTerminal = true
            return DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                waitForGrid(workspace: workspace, mode: mode, attemptsLeft: attemptsLeft - 1)
            }
        }
        session.revealTerminal = true
        if ProcessInfo.processInfo.environment["IDEALIZE_SELFTEST_NOFIX"] == "1" {
            session.terminalView.dragSelectsUnderMouseReporting = false
        }
        if mode == "synthetic" { feedSample(into: session.terminalView) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            drag(in: session, mode: mode)
        }
    }

    /// Sample agent output, then the exact mouse-tracking modes Claude Code turns
    /// on (`?1000h ?1002h ?1003h ?1006h`) — the state the bug needs.
    private static func feedSample(into tv: IDEalizeTerminalView) {
        tv.feed(text: "\u{1B}[2J\u{1B}[H")
        let lines = [
            "\u{1B}[36m●\u{1B}[0m I've fixed the selection handling in the terminal.",
            "",
            "  The foreground program was taking every drag, so nothing",
            "  was ever selected. A plain drag now belongs to selection.",
            "",
            "\u{1B}[32m✓\u{1B}[0m  Sources/IDEalizeApp/Model/IDEalizeTerminalView.swift",
            "\u{1B}[31merror:\u{1B}[0m no such module 'Nope'   \u{1B}[33mwarning:\u{1B}[0m unused result",
            "",
            "\u{1B}[2mdrag across these lines — they should come up highlighted\u{1B}[0m",
        ]
        tv.feed(text: lines.joined(separator: "\r\n") + "\r\n")
        tv.feed(text: "\u{1B}[?1000h\u{1B}[?1002h\u{1B}[?1003h\u{1B}[?1006h")
    }

    /// A plain, unmodified left drag across a few lines — the user's gesture.
    private static func drag(in session: TerminalSession, mode: String) {
        let tv = session.terminalView
        let terminal = tv.getTerminal()
        guard let window = tv.window else { return write(env: "IDEALIZE_SELFTEST_OUT", "no window") }
        let rows = max(terminal.rows, 1)
        let cell = tv.bounds.height / CGFloat(rows)
        func point(row: Int, fraction: CGFloat) -> NSPoint {
            tv.convert(NSPoint(x: tv.bounds.width * fraction,
                               y: tv.bounds.height - (CGFloat(row) + 0.5) * cell), to: nil)
        }
        func event(_ type: NSEvent.EventType, _ location: NSPoint) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: location, modifierFlags: [],
                               timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil,
                               eventNumber: 0, clickCount: 1, pressure: 1)
        }
        let (first, last) = mode == "claude" ? (2, 12) : (0, 8)
        if let down = event(.leftMouseDown, point(row: first, fraction: 0.02)) {
            tv.mouseDown(with: down)
        }
        for step in 1...8 {
            let t = CGFloat(step) / 8
            let row = first + Int((CGFloat(last - first) * t).rounded())
            if let dragged = event(.leftMouseDragged, point(row: row, fraction: 0.02 + 0.7 * t)) {
                tv.mouseDragged(with: dragged)
            }
        }
        if let up = event(.leftMouseUp, point(row: last, fraction: 0.72)) {
            tv.mouseUp(with: up)
        }
        tv.needsDisplay = true
        let selection = tv.getSelection() ?? ""
        write(env: "IDEALIZE_SELFTEST_OUT", """
            mode=\(mode)
            mouseMode=\(terminal.mouseMode)
            fixEnabled=\(tv.dragSelectsUnderMouseReporting)
            theme=\(AppSettings.shared.terminalTheme.name) \
            bgHex=\("\(AppSettings.shared.terminalBgHex)")
            selectedChars=\(selection.count)
            selected=\(!selection.isEmpty)
            sample=\(selection.prefix(90).replacingOccurrences(of: "\n", with: " ⏎ "))
            """)
        // Let the grid redraw the highlight before it's captured.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { capture(grid: tv) }
    }

    /// Render the grid to a PNG exactly as it's composited on screen: the theme's
    /// ground wash (a CAGradientLayer on the container, which the grid goes
    /// transparent over) with the grid's own ink drawn on top. `cacheDisplay`
    /// doesn't go through the window server, so this works with the app in the
    /// background, on another Space, or hidden — nothing is ever raised.
    private static func capture(grid tv: IDEalizeTerminalView) {
        guard let path = ProcessInfo.processInfo.environment["IDEALIZE_SELFTEST_PNG"],
              let ink = tv.bitmapImageRepForCachingDisplay(in: tv.bounds) else { return }
        tv.cacheDisplay(in: tv.bounds, to: ink)
        let theme = AppSettings.shared.terminalTheme
        let size = tv.bounds.size
        let rect = NSRect(origin: .zero, size: size)
        let image = NSImage(size: size)
        image.lockFocusFlipped(false)
        // The wash the grid sits on: a CAGradientLayer on the container view, which
        // the grid erases its own ground to transparent over. Draw it first…
        if let ctx = NSGraphicsContext.current?.cgContext,
           let stops = theme.backgroundGradient, stops.count > 1,
           let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                     colors: stops.reversed().map { ($0.usingColorSpace(.deviceRGB) ?? $0).cgColor } as CFArray,
                                     locations: nil) {
            ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height),
                                   options: [])
        } else {
            theme.background.setFill()
            rect.fill()
        }
        // …then the grid's ink over it. `cacheDisplay` gives an opaque bitmap, so
        // punch the erased ground back out: those pixels are the flat white the
        // caching bitmap starts from, and the wash belongs there.
        ink.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1,
                 respectFlipped: true, hints: nil)
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
        else { return }
        try? png.write(to: URL(fileURLWithPath: path))
        // Diagnostics: the same two passes on their own, so a bad composite is
        // obvious rather than mysterious.
        if let dir = ProcessInfo.processInfo.environment["IDEALIZE_SELFTEST_PARTS"] {
            let inkOnly = NSImage(size: size)
            inkOnly.lockFocusFlipped(false)
            ink.draw(in: rect)
            inkOnly.unlockFocus()
            writePNG(inkOnly, to: dir + "/ink.png")
            let washOnly = NSImage(size: size)
            washOnly.lockFocusFlipped(false)
            if let ctx = NSGraphicsContext.current?.cgContext,
               let stops = theme.backgroundGradient, stops.count > 1,
               let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                         colors: stops.reversed().map { ($0.usingColorSpace(.deviceRGB) ?? $0).cgColor } as CFArray,
                                         locations: nil) {
                ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            }
            washOnly.unlockFocus()
            writePNG(washOnly, to: dir + "/wash.png")
        }
    }

    private static func writePNG(_ image: NSImage, to path: String) {
        guard let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
        else { return }
        try? png.write(to: URL(fileURLWithPath: path))
    }

    private static func write(env key: String, _ text: String) {
        guard let path = ProcessInfo.processInfo.environment[key] else { return }
        try? (text + "\n").write(toFile: path, atomically: true, encoding: .utf8)
    }
}
