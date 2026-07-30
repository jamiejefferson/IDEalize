import SwiftUI
import AppKit
import Combine
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

    /// Holds the pinning constraints so the margin can be retuned live, and the
    /// temporary size constraints used to freeze the grid during a live resize.
    final class Coordinator {
        weak var container: NSView?
        weak var term: NSView?
        var leading: NSLayoutConstraint?
        var trailing: NSLayoutConstraint?
        var top: NSLayoutConstraint?
        var bottom: NSLayoutConstraint?
        var resizeObserver: AnyCancellable?
        private var freezeW: NSLayoutConstraint?
        private var freezeH: NSLayoutConstraint?

        /// Pin the terminal to its current pixel size for the duration of a live
        /// drag — of a window edge or of a panel divider. This stops SwiftTerm
        /// recomputing cols/rows on every intermediate frame — which otherwise
        /// fires a `SIGWINCH` storm that makes the foreground TUI full-repaint
        /// dozens of times a second. The grid snaps to the final size once, in
        /// `unfreeze()`.
        func freeze() {
            guard freezeW == nil, let term else { return }
            let size = term.frame.size
            guard size.width > 1, size.height > 1 else { return }
            // Release the edges that tie the terminal's size to the container;
            // keep leading/top so it stays anchored (top-left) while frozen.
            NSLayoutConstraint.deactivate([trailing, bottom].compactMap { $0 })
            let w = term.widthAnchor.constraint(equalToConstant: size.width)
            let h = term.heightAnchor.constraint(equalToConstant: size.height)
            NSLayoutConstraint.activate([w, h])
            freezeW = w; freezeH = h
        }

        /// Restore the fill constraints so the terminal reflows once to the
        /// window's final size.
        func unfreeze() {
            guard let w = freezeW, let h = freezeH else { return }
            NSLayoutConstraint.deactivate([w, h])
            NSLayoutConstraint.activate([trailing, bottom].compactMap { $0 })
            freezeW = nil; freezeH = nil
            container?.layoutSubtreeIfNeeded()
        }

        /// Drop any active freeze without re-activating the fill constraints,
        /// for when this representable is dismantled. The terminal NSView
        /// outlives the representable (the session owns it), and the freeze
        /// constraints are constants installed on the terminal itself — left
        /// active across a desktop ↔ compact layout swap they pin the grid at
        /// its old size and fight the next container's fill constraints, so
        /// the terminal never reflows to the mini-mode column.
        func releaseOnDismantle() {
            resizeObserver = nil
            if let w = freezeW, let h = freezeH {
                NSLayoutConstraint.deactivate([w, h])
            }
            freezeW = nil; freezeH = nil
        }
    }

    func makeNSView(context: Context) -> NSView {
        let container = TerminalContainerView()
        container.wantsLayer = true
        // Clip so a terminal that momentarily overflows (while frozen, if the
        // window shrinks mid-drag) never draws outside the pane.
        container.layer?.masksToBounds = true
        container.translatesAutoresizingMaskIntoConstraints = false
        let term = session.terminalView
        term.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(term)
        let inset = CGFloat(settings.terminalMargin)
        // Inset the grid left/right; SwiftTerm reflows to the narrower width.
        let leading = term.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: inset)
        let trailing = container.trailingAnchor.constraint(equalTo: term.trailingAnchor, constant: inset)
        let top = term.topAnchor.constraint(equalTo: container.topAnchor)
        let bottom = container.bottomAnchor.constraint(equalTo: term.bottomAnchor)
        NSLayoutConstraint.activate([leading, trailing, top, bottom])
        let coord = context.coordinator
        coord.container = container
        coord.term = term
        coord.leading = leading
        coord.trailing = trailing
        coord.top = top
        coord.bottom = bottom
        // Freeze the grid for any live resize — a window-edge drag or a panel
        // divider drag. The monitor coalesces both into one flag.
        coord.resizeObserver = LiveResizeMonitor.shared.$isResizing
            .removeDuplicates()
            .sink { [weak coord] resizing in
                if resizing { coord?.freeze() } else { coord?.unfreeze() }
            }
        // Paint the margin gap with the terminal's own background so it reads as
        // padding rather than a void. Read the colour from settings, not the
        // terminal view: on a theme tap this update runs before the onChange
        // that re-themes the sessions, so the view's own colour is still the
        // old theme's — which left the margins one tap behind.
        container.layer?.backgroundColor = settings.terminalTheme.background.cgColor
        hideScroller(term)
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        let inset = CGFloat(settings.terminalMargin)
        context.coordinator.leading?.constant = inset
        context.coordinator.trailing?.constant = inset
        nsView.layer?.backgroundColor = settings.terminalTheme.background.cgColor
        hideScroller(session.terminalView)
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.releaseOnDismantle()
    }

    /// SwiftTerm installs an `NSScroller` down the right edge, which reads as a
    /// permanent grey bar. Hiding it also zeroes the width it reserves
    /// (`reservedScrollerWidth`), so the grid reclaims that space.
    private func hideScroller(_ term: NSView) {
        for case let scroller as NSScroller in term.subviews where !scroller.isHidden {
            scroller.isHidden = true
        }
    }
}

/// Container that reports the window's live-resize boundaries so the terminal's
/// grid can be frozen for the duration of a drag (see `Coordinator.freeze`).
final class TerminalContainerView: NSView {
    /// Whether this container has an unbalanced `beginWindowResize` in flight.
    /// A container can be torn out of the hierarchy mid-drag — the desktop ↔
    /// compact layout swap happens the instant the width crosses the mini-mode
    /// breakpoint — and AppKit never sends `viewDidEndLiveResize` to a removed
    /// view. Without balancing on removal the monitor's refcount leaks,
    /// `isResizing` latches true, and every terminal created from then on is
    /// frozen at its birth size (stuck at the wrong width) for good.
    private var inWindowResize = false

    override func viewWillStartLiveResize() {
        super.viewWillStartLiveResize()
        inWindowResize = true
        LiveResizeMonitor.shared.beginWindowResize()
    }

    override func viewDidEndLiveResize() {
        super.viewDidEndLiveResize()
        guard inWindowResize else { return }
        inWindowResize = false
        LiveResizeMonitor.shared.endWindowResize()
    }

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        super.viewWillMove(toWindow: newWindow)
        if newWindow == nil, inWindowResize {
            inWindowResize = false
            LiveResizeMonitor.shared.endWindowResize()
        }
    }
}
