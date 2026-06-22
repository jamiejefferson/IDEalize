import SwiftUI
import AppKit

/// The individually-themeable surfaces of the app. Each carries its own
/// typography + background so Appearance can be tuned per panel — the USP.
enum PanelKind: String, CaseIterable, Identifiable, Codable {
    case sessions, files, terminal, chat, doc

    var id: String { rawValue }

    var label: String {
        switch self {
        case .sessions: return "Sessions"
        case .files:    return "Files"
        case .terminal: return "Terminal"
        case .chat:     return "Chat"
        case .doc:      return "Document"
        }
    }

    var icon: String {
        switch self {
        case .sessions: return "sidebar.left"
        case .files:    return "folder"
        case .terminal: return "terminal"
        case .chat:     return "bubble.left.and.bubble.right"
        case .doc:      return "doc.text"
        }
    }
}

/// How a surface (panel background or action colour) is filled.
enum FillMode: Int, Codable, CaseIterable { case inherit = 0, solid = 1, gradient = 2 }

/// The shape of a multi-stop gradient.
enum GradientType: Int, Codable, CaseIterable {
    case linear = 0, radial = 1, angular = 2
    var label: String {
        switch self {
        case .linear: return "Linear"
        case .radial: return "Radial"
        case .angular: return "Angular"
        }
    }
}

/// One colour stop in a multi-colour gradient (Figma-style).
struct GradientStop: Codable, Equatable, Identifiable {
    var id = UUID()
    var colorHex: String
    var location: Double   // 0…1

    private enum CodingKeys: String, CodingKey { case colorHex, location }
}

/// Build a SwiftUI gradient `ShapeStyle` from stops + type + angle.
func makeGradientStyle(_ stops: [GradientStop], type: GradientType, angle: Double) -> AnyShapeStyle {
    let sorted = stops.sorted { $0.location < $1.location }
    let gStops = sorted.map { s in
        Gradient.Stop(color: NSColor(hex: s.colorHex).map { Color($0) } ?? .clear,
                      location: CGFloat(min(1, max(0, s.location))))
    }
    let g = Gradient(stops: gStops.isEmpty ? [.init(color: .clear, location: 0)] : gStops)
    switch type {
    case .linear:
        let (start, end) = gradientPoints(angle)
        return AnyShapeStyle(LinearGradient(gradient: g, startPoint: start, endPoint: end))
    case .radial:
        return AnyShapeStyle(RadialGradient(gradient: g, center: .center, startRadius: 0, endRadius: 240))
    case .angular:
        return AnyShapeStyle(AngularGradient(gradient: g, center: .center, angle: .degrees(angle)))
    }
}

/// Two default stops from legacy two-colour fields (for back-compat / first edit).
func defaultStops(_ c1: String, _ c2: String, _ d1: NSColor, _ d2: NSColor) -> [GradientStop] {
    [GradientStop(colorHex: NSColor(hex: c1)?.hexString ?? d1.hexString, location: 0),
     GradientStop(colorHex: NSColor(hex: c2)?.hexString ?? d2.hexString, location: 1)]
}

/// Per-panel typography + background overrides. All fields default to a
/// sentinel ("inherit") so an untouched panel tracks the active theme.
struct PanelAppearance: Codable, Equatable {
    // Typography — "" / 0 mean "inherit the panel's natural default".
    var fontName: String = ""
    var fontSize: Double = 0          // absolute base; 0 = panel default
    var fontWeight: Int = 0           // 0 = inherit; 1…9 = ultraLight…black
    var tracking: Double = 0          // letter-spacing (pt)
    var lineSpacing: Double = 0       // extra line spacing (pt)
    var textColorHex: String = ""     // "" = theme foreground

    // Background
    var bgMode: Int = 0               // FillMode
    var bgColorHex: String = ""       // solid fill / legacy gradient start
    var bgColor2Hex: String = ""      // legacy gradient end stop
    var gradientAngle: Double = 90    // degrees
    var bgOpacity: Double = 1.0
    // Multi-stop gradient (Figma-style). Empty → derived from the two legacy hexes.
    var bgGradientType: Int = 0       // GradientType
    var bgGradientStops: [GradientStop] = []

    static let empty = PanelAppearance()

    var isCustomised: Bool { self != .empty }

    /// The gradient stops to render — explicit if present, else the two legacy hexes.
    func resolvedStops(default d1: NSColor, _ d2: NSColor) -> [GradientStop] {
        bgGradientStops.count >= 1 ? bgGradientStops : defaultStops(bgColorHex, bgColor2Hex, d1, d2)
    }
}

/// The global "action colour" used for primary buttons and the
/// selected/focused-panel highlight.
struct ActionAppearance: Codable, Equatable {
    var mode: Int = 0                 // 0 solid, 1 gradient
    var colorHex: String = ""         // "" = theme accent
    var color2Hex: String = ""
    var angle: Double = 90
    var opacity: Double = 1.0
    var gradientType: Int = 0         // GradientType
    var gradientStops: [GradientStop] = []

    static let empty = ActionAppearance()

    func resolvedStops(default d1: NSColor, _ d2: NSColor) -> [GradientStop] {
        gradientStops.count >= 1 ? gradientStops : defaultStops(colorHex, color2Hex, d1, d2)
    }
}

// MARK: - Weight mapping

enum AppearanceWeights {
    /// 0 = inherit; 1…9 map to the standard SwiftUI weights.
    static let labels = ["Default", "Ultralight", "Thin", "Light", "Regular",
                         "Medium", "Semibold", "Bold", "Heavy", "Black"]

    static func weight(_ i: Int) -> Font.Weight? {
        switch i {
        case 1: return .ultraLight
        case 2: return .thin
        case 3: return .light
        case 4: return .regular
        case 5: return .medium
        case 6: return .semibold
        case 7: return .bold
        case 8: return .heavy
        case 9: return .black
        default: return nil
        }
    }
}

/// Convert an angle in degrees to a SwiftUI gradient start/end pair.
func gradientPoints(_ angle: Double) -> (UnitPoint, UnitPoint) {
    let rad = angle * .pi / 180
    let dx = cos(rad), dy = sin(rad)
    return (UnitPoint(x: 0.5 - dx / 2, y: 0.5 - dy / 2),
            UnitPoint(x: 0.5 + dx / 2, y: 0.5 + dy / 2))
}

// MARK: - Resolved style (what views actually consume)

/// A resolved per-panel style: fonts/colours/background derived from a
/// `PanelAppearance` layered over the active theme + global font settings.
struct PanelStyle {
    let appearance: PanelAppearance
    let theme: Theme
    let settings: AppSettings
    /// The panel's natural primary text size; per-panel size scales relative to it.
    let baseSize: CGFloat
    /// The panel's natural background when nothing is overridden.
    let defaultBackground: NSColor

    private var scale: CGFloat {
        appearance.fontSize > 0 ? CGFloat(appearance.fontSize) / baseSize : 1
    }

    /// A font for text of natural `size`, scaled by the panel's size override.
    func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let s = size * scale
        let w = AppearanceWeights.weight(appearance.fontWeight) ?? weight
        if !appearance.fontName.isEmpty {
            return .custom(appearance.fontName, size: s).weight(w)
        }
        if !settings.uiFontName.isEmpty {
            return .custom(settings.uiFontName, size: s).weight(w)
        }
        return .system(size: s, weight: w)
    }

    var tracking: CGFloat { CGFloat(appearance.tracking) }
    var lineSpacing: CGFloat { CGFloat(appearance.lineSpacing) }

    var textColor: Color {
        if let c = NSColor(hex: appearance.textColorHex) { return Color(c) }
        return Color(theme.foreground)
    }

    var secondaryTextColor: Color {
        if let c = NSColor(hex: appearance.textColorHex) {
            return Color(c).opacity(0.55)
        }
        return Color(theme.secondaryForeground)
    }

    /// True when a custom background fill is configured.
    var hasCustomBackground: Bool {
        (FillMode(rawValue: appearance.bgMode) ?? .inherit) != .inherit
    }

    /// The panel's background as a SwiftUI view.
    @ViewBuilder
    var background: some View {
        switch FillMode(rawValue: appearance.bgMode) ?? .inherit {
        case .inherit:
            Color(defaultBackground)
        case .solid:
            (NSColor(hex: appearance.bgColorHex).map { Color($0) } ?? Color(defaultBackground))
                .opacity(appearance.bgOpacity)
        case .gradient:
            Rectangle().fill(gradientStyle).opacity(appearance.bgOpacity)
        }
    }

    var gradientStyle: AnyShapeStyle {
        makeGradientStyle(appearance.resolvedStops(default: defaultBackground, theme.surface),
                          type: GradientType(rawValue: appearance.bgGradientType) ?? .linear,
                          angle: appearance.gradientAngle)
    }
}

/// The resolved global action style for buttons + selection highlights.
struct ActionStyle {
    let appearance: ActionAppearance
    let theme: Theme

    var color: Color {
        if let c = NSColor(hex: appearance.colorHex) { return Color(c) }
        return Color(theme.accent)
    }

    private var accentColor: NSColor { theme.accent }

    private var gradientStyle: AnyShapeStyle {
        makeGradientStyle(appearance.resolvedStops(default: accentColor, accentColor),
                          type: GradientType(rawValue: appearance.gradientType) ?? .linear,
                          angle: appearance.angle)
    }

    /// A `ShapeStyle` suitable for filling button backgrounds / highlights.
    var fill: AnyShapeStyle {
        if appearance.mode == 1 {
            return AnyShapeStyle(gradientStyle.opacity(appearance.opacity))
        }
        return AnyShapeStyle(color.opacity(appearance.opacity))
    }

    /// A translucent version for soft selection backgrounds.
    var softFill: AnyShapeStyle {
        if appearance.mode == 1 {
            return AnyShapeStyle(gradientStyle.opacity(appearance.opacity * 0.18))
        }
        return AnyShapeStyle(color.opacity(appearance.opacity * 0.18))
    }
}

// MARK: - View glue

extension View {
    /// Apply a panel style's typography (tracking + line-spacing) in one place.
    func panelText(_ style: PanelStyle) -> some View {
        self.tracking(style.tracking).lineSpacing(style.lineSpacing)
    }
}
