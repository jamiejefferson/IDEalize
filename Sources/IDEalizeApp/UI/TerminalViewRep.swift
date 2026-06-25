import SwiftUI
import AppKit
import SwiftTerm

/// Hosts a session's `LocalProcessTerminalView` inside SwiftUI. The terminal
/// view is created once and owned by the session, so it survives view updates
/// (re-layouts) without restarting the process.
struct TerminalViewRep: NSViewRepresentable {
    let session: TerminalSession
    /// Observed so a change to `terminalMargin` re-runs `updateNSView`.
    @ObservedObject private var settings = AppSettings.shared

    init(session: TerminalSession) { self.session = session }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Holds the side constraints so the margin can be retuned live.
    final class Coordinator {
        var leading: NSLayoutConstraint?
        var trailing: NSLayoutConstraint?
    }

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        container.wantsLayer = true
        container.translatesAutoresizingMaskIntoConstraints = false
        let term = session.terminalView
        term.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(term)
        let inset = CGFloat(settings.terminalMargin)
        // Inset the grid left/right; SwiftTerm reflows to the narrower width.
        let leading = term.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: inset)
        let trailing = container.trailingAnchor.constraint(equalTo: term.trailingAnchor, constant: inset)
        NSLayoutConstraint.activate([
            leading, trailing,
            term.topAnchor.constraint(equalTo: container.topAnchor),
            term.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        context.coordinator.leading = leading
        context.coordinator.trailing = trailing
        // Paint the margin gap with the terminal's own background so it reads as
        // padding rather than a void.
        container.layer?.backgroundColor = term.nativeBackgroundColor.cgColor
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        let inset = CGFloat(settings.terminalMargin)
        context.coordinator.leading?.constant = inset
        context.coordinator.trailing?.constant = inset
        nsView.layer?.backgroundColor = session.terminalView.nativeBackgroundColor.cgColor
    }
}
