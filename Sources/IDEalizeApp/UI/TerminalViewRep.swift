import SwiftUI
import AppKit
import SwiftTerm

/// Hosts a session's `LocalProcessTerminalView` inside SwiftUI. The terminal
/// view is created once and owned by the session, so it survives view updates
/// (re-layouts) without restarting the process.
struct TerminalViewRep: NSViewRepresentable {
    let session: TerminalSession

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        let term = session.terminalView
        term.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(term)
        NSLayoutConstraint.activate([
            term.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            term.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            term.topAnchor.constraint(equalTo: container.topAnchor),
            term.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
