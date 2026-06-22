import AppKit
import SwiftTerm

/// Maps SwiftTerm cell colors to NSColors, honoring the active theme for the
/// 16 ANSI colors and the default fg/bg, and the standard xterm cube for 16-255.
enum AnsiColor {
    /// Resolve a foreground color for a cell.
    static func foreground(_ color: Attribute.Color, theme: Theme) -> NSColor {
        switch color {
        case .defaultColor: return theme.foreground
        case .defaultInvertedColor: return theme.background
        case .trueColor(let r, let g, let b):
            return NSColor(srgbRed: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: 1)
        case .ansi256(let code): return palette(Int(code), theme: theme)
        }
    }

    static func background(_ color: Attribute.Color, theme: Theme) -> NSColor? {
        switch color {
        case .defaultColor, .defaultInvertedColor: return nil
        case .trueColor(let r, let g, let b):
            return NSColor(srgbRed: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: 1)
        case .ansi256(let code): return palette(Int(code), theme: theme)
        }
    }

    /// xterm 256-color palette. 0-15 come from the theme; 16-231 the color cube;
    /// 232-255 the grayscale ramp.
    static func palette(_ code: Int, theme: Theme) -> NSColor {
        if code < 16 { return theme.ansi[max(0, min(15, code))] }
        if code >= 232 {
            let level = 8 + (code - 232) * 10
            return NSColor(srgbRed: CGFloat(level)/255, green: CGFloat(level)/255, blue: CGFloat(level)/255, alpha: 1)
        }
        let c = code - 16
        let r = (c / 36) % 6
        let g = (c / 6) % 6
        let b = c % 6
        func comp(_ v: Int) -> CGFloat { v == 0 ? 0 : CGFloat(55 + v * 40) / 255 }
        return NSColor(srgbRed: comp(r), green: comp(g), blue: comp(b), alpha: 1)
    }
}
