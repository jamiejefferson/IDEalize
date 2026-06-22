import AppKit

/// A terminal color scheme. The 16 ANSI colors plus fg/bg/cursor.
struct Theme: Identifiable, Hashable {
    var id: String { name }
    let name: String
    let background: NSColor
    let foreground: NSColor
    let cursor: NSColor
    let selection: NSColor
    /// 16 ANSI colors (0-7 normal, 8-15 bright).
    let ansi: [NSColor]

    static func rgb(_ r: Int, _ g: Int, _ b: Int) -> NSColor {
        NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1)
    }

    /// Default dark theme tuned for AI coding sessions — deep slate, high
    /// contrast text, calm accent colors.
    static let idealizeDark = Theme(
        name: "IDEalize Dark",
        background: rgb(22, 24, 30),
        foreground: rgb(222, 227, 234),
        cursor: rgb(111, 194, 255),
        selection: rgb(45, 60, 86),
        ansi: [
            rgb(60, 66, 77),   rgb(255, 123, 114), rgb(126, 231, 135), rgb(255, 212, 102),
            rgb(111, 194, 255),rgb(210, 168, 255), rgb(86, 211, 222),  rgb(201, 209, 217),
            rgb(110, 118, 129),rgb(255, 160, 152), rgb(160, 245, 168), rgb(255, 224, 150),
            rgb(140, 192, 255),rgb(225, 195, 255), rgb(150, 230, 240), rgb(244, 248, 255),
        ]
    )

    /// Linear blend between two colors in sRGB. `t`=0 → a, `t`=1 → b.
    private func blend(_ a: NSColor, _ b: NSColor, _ t: CGFloat) -> NSColor {
        let x = a.usingColorSpace(.sRGB) ?? a
        let y = b.usingColorSpace(.sRGB) ?? b
        return NSColor(srgbRed: x.redComponent + (y.redComponent - x.redComponent) * t,
                       green: x.greenComponent + (y.greenComponent - x.greenComponent) * t,
                       blue: x.blueComponent + (y.blueComponent - x.blueComponent) * t,
                       alpha: 1)
    }

    // MARK: Semantic surfaces (derived so they track any theme's bg/fg)

    /// Slightly elevated surface for the top/bottom chrome bars.
    var chrome: NSColor { blend(background, foreground, 0.045) }
    /// Command-block card background.
    var surface: NSColor { blend(background, foreground, 0.055) }
    /// Command-block card background on hover.
    var surfaceHover: NSColor { blend(background, foreground, 0.095) }
    /// The raised command bar surface (more prominent than a block).
    var elevated: NSColor { blend(background, foreground, 0.08) }
    /// Hairline borders / dividers.
    var border: NSColor { blend(background, foreground, 0.16) }
    /// De-emphasized text (metadata, hints). Kept reasonably high-contrast so
    /// labels stay readable even on low-contrast themes (e.g. Solarized).
    var secondaryForeground: NSColor { blend(foreground, background, 0.30) }
    /// Accent used for prompts, focus, and primary affordances.
    var accent: NSColor { cursor }

    /// Whether this theme is dark (drives the window's NSAppearance so system
    /// controls — pickers, sliders, toggles — render light/dark to match).
    var isDark: Bool {
        let c = background.usingColorSpace(.sRGB) ?? background
        let lum = 0.299 * c.redComponent + 0.587 * c.greenComponent + 0.114 * c.blueComponent
        return lum < 0.5
    }

    static let idealizeLight = Theme(
        name: "IDEalize Light",
        background: rgb(255, 255, 255),
        foreground: rgb(36, 41, 47),
        cursor: rgb(9, 105, 218),
        selection: rgb(204, 228, 255),
        ansi: [
            rgb(36, 41, 47),  rgb(207, 34, 46),  rgb(26, 127, 55),  rgb(154, 103, 0),
            rgb(9, 105, 218), rgb(130, 80, 223), rgb(31, 136, 153), rgb(110, 119, 129),
            rgb(87, 96, 106), rgb(164, 14, 38),  rgb(26, 127, 55),  rgb(154, 103, 0),
            rgb(9, 105, 218), rgb(130, 80, 223), rgb(31, 136, 153), rgb(13, 17, 23),
        ]
    )

    static let solarizedDark = Theme(
        name: "Solarized Dark",
        background: rgb(0, 43, 54),
        foreground: rgb(131, 148, 150),
        cursor: rgb(131, 148, 150),
        selection: rgb(7, 54, 66),
        ansi: [
            rgb(7, 54, 66),    rgb(220, 50, 47),  rgb(133, 153, 0),  rgb(181, 137, 0),
            rgb(38, 139, 210), rgb(211, 54, 130), rgb(42, 161, 152), rgb(238, 232, 213),
            rgb(0, 43, 54),    rgb(203, 75, 22),  rgb(88, 110, 117), rgb(101, 123, 131),
            rgb(131, 148, 150),rgb(108, 113, 196),rgb(147, 161, 161),rgb(253, 246, 227),
        ]
    )

    static let all: [Theme] = [.idealizeDark, .idealizeLight, .solarizedDark]

    static func named(_ name: String) -> Theme {
        all.first { $0.name == name } ?? .idealizeDark
    }
}

extension NSColor {
    /// Parse a "#RRGGBB" / "RRGGBB" hex string. Returns nil for empty/invalid.
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = Int(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xFF) / 255,
                  green: CGFloat((v >> 8) & 0xFF) / 255,
                  blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    /// "#RRGGBB" representation.
    var hexString: String {
        let c = usingColorSpace(.sRGB) ?? self
        return String(format: "#%02X%02X%02X",
                      Int(round(c.redComponent * 255)),
                      Int(round(c.greenComponent * 255)),
                      Int(round(c.blueComponent * 255)))
    }
}
