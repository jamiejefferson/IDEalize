import SwiftUI
import AppKit

/// Which screen edge the mini-mode column docks against.
enum DockSide: String, CaseIterable, Identifiable {
    case left, right
    var id: String { rawValue }
    var displayName: String { rawValue.capitalized }
}

/// Phase-1 mini-mode controller: capture the window's current bounds, resize it
/// to a narrow docked column, and restore the original bounds on exit.
///
/// The pre-mini-mode frame is persisted so a crash or relaunch never loses the
/// user's original window arrangement. If the app is quit while in mini-mode it
/// will reopen in mini-mode.
final class MiniModeManager: ObservableObject {
    static let shared = MiniModeManager()

    /// Smallest width the mini-mode column is allowed to take, even on tiny
    /// screens. This is a Phase-1 usability floor; the compact layout in later
    /// phases may raise it.
    static let minWidth: CGFloat = 320
    /// Target fraction of the working screen width (about one fifth).
    static let widthFraction: CGFloat = 0.20

    @Published var isEnabled: Bool {
        didSet { AppSettings.shared.miniModeEnabled = isEnabled }
    }

    /// Transient copies used for the current toggle session. Persisted copies
    /// live in `AppSettings` so they survive restarts.
    private var savedFrame: NSRect?
    private var savedIsZoomed: Bool?

    private init() {
        isEnabled = AppSettings.shared.miniModeEnabled
    }

    /// Toggle in or out of mini-mode on the app's main window.
    func toggle() {
        guard let window = targetWindow() else { return }
        if isEnabled {
            disable(window: window)
        } else {
            enable(window: window, saveCurrentState: true)
        }
    }

    /// Re-apply mini-mode on launch when the previous session ended in it.
    /// Does NOT capture the launch frame as the "previous" frame — the persisted
    /// one from before entering mini-mode is preserved.
    func restoreIfNeeded() {
        guard isEnabled, let window = targetWindow() else { return }
        enable(window: window, saveCurrentState: false)
    }

    /// The app's main window, even when another window (Settings) is key.
    private func targetWindow() -> NSWindow? {
        NSApp.windows.first { $0.identifier?.rawValue == "main" }
            ?? NSApp.keyWindow
            ?? NSApp.mainWindow
            ?? NSApp.windows.first
    }

    /// Re-apply current dock-side / always-on-top settings while in mini-mode.
    func refreshIfNeeded() {
        guard isEnabled, let window = targetWindow() else { return }
        window.level = AppSettings.shared.miniModeAlwaysOnTop ? .floating : .normal
        enable(window: window, saveCurrentState: false)
    }

    private func enable(window: NSWindow, saveCurrentState: Bool) {
        if saveCurrentState {
            savedFrame = window.frame
            savedIsZoomed = window.isZoomed
            AppSettings.shared.miniModePreFrame = window.frame
            AppSettings.shared.miniModePreZoomed = window.isZoomed
        } else {
            savedFrame = AppSettings.shared.miniModePreFrame
            savedIsZoomed = AppSettings.shared.miniModePreZoomed
        }

        guard let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let targetWidth = max(Self.minWidth, visible.width * Self.widthFraction)
        let x: CGFloat = AppSettings.shared.miniModeDockSide == .left
            ? visible.minX
            : visible.maxX - targetWidth
        let targetFrame = NSRect(
            x: x,
            y: visible.minY,
            width: targetWidth,
            height: visible.height
        )

        // Drop the window's minimum content size *now*, synchronously: the root
        // view's `.frame(minWidth:)` propagates to `contentMinSize`, and while
        // that floor is still 900 (SwiftUI only relaxes it on the next render)
        // AppKit would clamp this resize back up. Setting it here lets the column
        // actually reach its narrow target; SwiftUI then reconciles to the same
        // value once `isEnabled` re-renders.
        window.contentMinSize = NSSize(width: Self.minWidth, height: 380)
        window.setFrame(targetFrame, display: true, animate: true)
        window.level = AppSettings.shared.miniModeAlwaysOnTop ? .floating : .normal

        isEnabled = true
    }

    private func disable(window: NSWindow) {
        // Let the window grow back before SwiftUI restores the 900 floor.
        window.contentMinSize = NSSize(width: Self.minWidth, height: 380)
        if let frame = savedFrame ?? AppSettings.shared.miniModePreFrame {
            window.setFrame(frame, display: true, animate: true)
            let shouldZoom = savedIsZoomed ?? AppSettings.shared.miniModePreZoomed
            if shouldZoom, !window.isZoomed {
                window.zoom(nil)
            }
        }
        window.level = .normal
        isEnabled = false
    }
}
