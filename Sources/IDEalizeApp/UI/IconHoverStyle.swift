import SwiftUI

// Shared hover feedback for the app's many compact icon buttons. The glyphs are
// small and easy to miss, so every icon control gets a visible hot area: flat
// buttons pick up a soft rounded background, and buttons that already carry their
// own filled shape (send, stop, new-tab …) get a gentle lift instead of a second
// competing background.

/// Subtle rounded hover/press background for flat icon buttons. Adds a little
/// padding too, so the tappable area is comfortably bigger than the glyph.
struct IconHoverStyle: ButtonStyle {
    @ObservedObject private var settings = AppSettings.shared
    var padding: CGFloat = 3
    var radius: CGFloat = 6
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color(settings.theme.surfaceHover))
                    .opacity(hovering || configuration.isPressed ? 1 : 0)
            )
            .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .onHover { hovering = $0 }
            .animation(.easeOut(duration: 0.12), value: hovering)
            .animation(.easeOut(duration: 0.09), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == IconHoverStyle {
    /// Default flat-icon hover: soft rounded highlight on hover/press.
    static var iconHover: IconHoverStyle { IconHoverStyle() }
    /// Flat-icon hover with a custom hot-area inset (tighter for tiny close
    /// glyphs, roomier for stand-alone controls).
    static func iconHover(padding: CGFloat, radius: CGFloat = 6) -> IconHoverStyle {
        IconHoverStyle(padding: padding, radius: radius)
    }
}

/// A gentle hover lift for icon buttons that already draw their own filled shape
/// (a circle or rounded square). No extra background — just a small scale and a
/// touch of brightness so the control still answers to the pointer.
struct RaisedIconHoverStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(hovering && !configuration.isPressed ? 0.06 : 0)
            .scaleEffect(configuration.isPressed ? 0.9 : (hovering ? 1.08 : 1))
            .onHover { hovering = $0 }
            .animation(.easeOut(duration: 0.12), value: hovering)
            .animation(.spring(response: 0.26, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == RaisedIconHoverStyle {
    static var raisedIconHover: RaisedIconHoverStyle { RaisedIconHoverStyle() }
}
