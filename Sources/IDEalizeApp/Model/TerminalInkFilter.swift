import AppKit
import Foundation

/// Adjusts the ink of the terminal's incoming stream: repaints the box-drawing
/// characters an agent frames its prompt box with, and softens the dim attribute
/// so secondary text stays readable.
///
/// Both exist because a program's own colour choices can't be reached any other
/// way. It names a colour either from the shared 16-colour palette — which its
/// body text draws from too, so dimming a slot dims the transcript with it — or
/// in fixed 24-bit values the terminal doesn't own at all. What *can* be singled
/// out is the character (box drawing is U+2500–U+257F and nothing else) and the
/// attribute (SGR 2). So:
///
/// - **Rules.** Claude Code's light theme rules its box in `#888888` while
///   writing its text in `#999999`, so the frame lands heavier than the words
///   inside it. Runs of box-drawing characters are repainted in `ruleColor`.
/// - **Dim.** SwiftTerm renders SGR 2 as a fixed 50% blend toward the ground,
///   which on warm paper turns `#999999` into `#C8C7C5` — past readable. The
///   attribute is stripped and replaced with an explicit blend at `dimBlend`.
///
/// This runs on every byte the terminal receives, so the no-op path allocates
/// nothing: a chunk with neither an escape nor a `0xE2` lead byte can't contain
/// anything of interest and is waved straight through.
struct TerminalInkFilter {
    /// The colour box-drawing runs are repainted in. nil leaves them alone.
    var ruleColor: NSColor? { didSet { ruleSGR = Self.trueColorSGR(ruleColor) } }
    /// The colour the prompt-marker chevron (`›` / `❯`) is tinted, so your own
    /// inputs are easy to pick out scrolling back through a chat. nil leaves it alone.
    var markerColor: NSColor? { didSet { markerSGR = Self.trueColorSGR(markerColor) } }
    /// How far dim text is blended toward the ground. SwiftTerm's own is 0.5,
    /// which is heavier than most themes want. nil leaves the attribute alone.
    var dimBlend: CGFloat?
    /// The theme, for resolving what a program asks for into actual colour.
    var background: NSColor = .black
    var foreground: NSColor = .white
    /// The 16 ANSI colours.
    var palette: [NSColor] = []

    /// What a program last asked the foreground to be — kept in its original
    /// form so a palette colour can be restored as a palette colour, and go on
    /// tracking the theme, rather than being frozen into 24-bit.
    private enum Foreground: Equatable {
        case `default`
        case indexed(Int)
        case rgb(UInt8, UInt8, UInt8)
    }
    private var foregroundSpec: Foreground = .default
    private var dim = false

    /// Where the byte stream currently is. Escape sequences carry arbitrary
    /// payloads — an OSC window title could hold a box-drawing character, and
    /// inserting a colour into one would corrupt it — so rewriting only ever
    /// happens in `ground`.
    private enum Scan: Equatable {
        case ground
        case escape          // saw ESC
        case csi([UInt8])    // ESC [ …, collecting parameter bytes
        case string(Bool)    // OSC/DCS/APC payload; flag: previous byte was ESC
    }
    private var scan: Scan = .ground

    private var ruleSGR: [UInt8]?
    private var markerSGR: [UInt8]?
    /// Bytes held back because a character straddled the chunk end.
    private var carry: [UInt8] = []
    /// An escape sequence being collected. Nothing is emitted until the final
    /// byte arrives, because an SGR is rewritten as a whole and its parameters
    /// can't be taken back once they've gone downstream. A sequence split across
    /// two reads therefore waits here for its tail — which costs nothing, since
    /// the terminal's own parser would hold an incomplete sequence just the same.
    private var pending: [UInt8] = []

    private static let escape: UInt8 = 0x1B
    private static let bell: UInt8 = 0x07

    // MARK: - Entry point

    /// The chunk with rules repainted and dim softened, or nil when there's
    /// nothing to change and the original bytes can be used as they are.
    mutating func process(_ slice: ArraySlice<UInt8>) -> [UInt8]? {
        let interesting = ruleSGR != nil || dimBlend != nil || markerSGR != nil
        guard interesting else {
            carry.removeAll(keepingCapacity: true)
            pending.removeAll(keepingCapacity: true)
            return nil
        }
        // Mid-sequence or mid-character from last time, or something to act on.
        guard !carry.isEmpty || scan != .ground
                || slice.contains(0xE2) || slice.contains(Self.escape) else { return nil }

        let input: [UInt8] = carry.isEmpty ? Array(slice) : carry + slice
        carry.removeAll(keepingCapacity: true)

        var out: [UInt8] = []
        out.reserveCapacity(input.count + 64)
        var inRule = false
        var index = 0

        while index < input.count {
            let byte = input[index]

            switch scan {
            case .ground:
                if byte == Self.escape {
                    if inRule { out.append(contentsOf: restoreForegroundSGR()); inRule = false }
                    scan = .escape
                    pending = [byte]
                    index += 1
                    continue
                }
                if byte == 0xE2, ruleSGR != nil || markerSGR != nil {
                    guard index + 2 < input.count else {
                        carry = Array(input[index...])   // straddles the chunk end
                        index = input.count
                        continue
                    }
                    let second = input[index + 1], third = input[index + 2]
                    // Box-drawing run (U+2500–U+257F) → the rule colour.
                    if ruleSGR != nil, second == 0x94 || second == 0x95, (0x80...0xBF).contains(third) {
                        if !inRule, let ruleSGR {
                            out.append(contentsOf: ruleSGR)
                            inRule = true
                        }
                        out.append(byte); out.append(second); out.append(third)
                        index += 3
                        continue
                    }
                    // Prompt-marker chevron (`›` U+203A = E2 80 BA, `❯` U+276F =
                    // E2 9D AF) → the highlight colour. Only the one glyph is
                    // recoloured; the text after it reverts to what the program set,
                    // so your inputs carry a bright marker that's easy to spot on
                    // scrollback without repainting the whole line.
                    if let markerSGR, !inRule,
                       (second == 0x80 && third == 0xBA) || (second == 0x9D && third == 0xAF) {
                        out.append(contentsOf: markerSGR)
                        out.append(byte); out.append(second); out.append(third)
                        out.append(contentsOf: restoreForegroundSGR())
                        index += 3
                        continue
                    }
                }
                if inRule { out.append(contentsOf: restoreForegroundSGR()); inRule = false }
                out.append(byte)
                index += 1

            case .escape:
                pending.append(byte)
                index += 1
                switch byte {
                case UInt8(ascii: "["):
                    scan = .csi([])
                // OSC / DCS / SOS / PM / APC all carry a string payload, which
                // is never rewritten — so it can go out as it arrives.
                case UInt8(ascii: "]"), UInt8(ascii: "P"), UInt8(ascii: "X"),
                     UInt8(ascii: "^"), UInt8(ascii: "_"):
                    scan = .string(false)
                    out.append(contentsOf: pending)
                    pending.removeAll(keepingCapacity: true)
                default:
                    scan = .ground
                    out.append(contentsOf: pending)
                    pending.removeAll(keepingCapacity: true)
                }

            case .csi(var params):
                pending.append(byte)
                index += 1
                // Parameter and intermediate bytes come before the final byte.
                if (0x30...0x3F).contains(byte) || (0x20...0x2F).contains(byte) {
                    params.append(byte)
                    scan = .csi(params)
                    continue
                }
                scan = .ground
                if byte == UInt8(ascii: "m") {
                    out.append(contentsOf: rewriteSGR(params))
                } else {
                    out.append(contentsOf: pending)
                }
                pending.removeAll(keepingCapacity: true)

            case .string(let sawEscape):
                out.append(byte)
                index += 1
                if byte == Self.bell {
                    scan = .ground
                } else if sawEscape {
                    scan = byte == UInt8(ascii: "\\") ? .ground : .string(false)
                } else if byte == Self.escape {
                    scan = .string(true)
                }
            }
        }
        // Never leave the rule colour set across a chunk boundary.
        if inRule { out.append(contentsOf: restoreForegroundSGR()) }
        return out
    }

    // MARK: - SGR

    /// Rewrite one `ESC [ … m`: track what it does to the foreground and to the
    /// dim attribute, drop the dim parameter, and put an explicit colour in its
    /// place. Anything that isn't about the foreground passes through untouched,
    /// so bold, italics, underline and background colours are unaffected.
    ///
    /// Returns the whole replacement sequence, `ESC [` included — which may be
    /// nothing at all, so the prefix can't be the caller's to write.
    private mutating func rewriteSGR(_ params: [UInt8]) -> [UInt8] {
        let verbatim = Array("\u{1B}[".utf8) + params + [UInt8(ascii: "m")]
        let text = String(decoding: params, as: UTF8.self)
        // A private-mode sequence (`ESC [ ? … m`) isn't an SGR we should touch.
        guard !text.contains("?"), !text.contains(">"), !text.contains("<") else {
            return verbatim
        }
        let codes = text.split(separator: ";", omittingEmptySubsequences: false)
                        .map { Int($0) ?? 0 }
        let wasDim = dim
        var kept: [String] = []
        var reset = false
        var index = 0

        while index < codes.count {
            let code = codes[index]
            switch code {
            case 0:
                dim = false
                foregroundSpec = .default
                reset = true
                kept.append("0")
            case 2:
                dim = true          // dropped: we colour it ourselves
            case 22:
                dim = false
                kept.append("22")
            case 30...37:
                foregroundSpec = .indexed(code - 30)
                kept.append("\(code)")
            case 90...97:
                foregroundSpec = .indexed(code - 90 + 8)
                kept.append("\(code)")
            case 39:
                foregroundSpec = .default
                kept.append("39")
            case 38:
                // 38;5;n or 38;2;r;g;b
                if index + 1 < codes.count, codes[index + 1] == 5, index + 2 < codes.count {
                    foregroundSpec = .indexed(codes[index + 2])
                    kept.append(contentsOf: ["38", "5", "\(codes[index + 2])"])
                    index += 2
                } else if index + 1 < codes.count, codes[index + 1] == 2, index + 4 < codes.count {
                    foregroundSpec = .rgb(UInt8(clamping: codes[index + 2]),
                                          UInt8(clamping: codes[index + 3]),
                                          UInt8(clamping: codes[index + 4]))
                    kept.append(contentsOf: ["38", "2", "\(codes[index + 2])",
                                             "\(codes[index + 3])", "\(codes[index + 4])"])
                    index += 4
                } else {
                    kept.append("38")
                }
            default:
                kept.append("\(code)")
            }
            index += 1
        }

        // Not softening dim: the sequence goes out exactly as it came in, having
        // served only to keep the foreground state current.
        guard dimBlend != nil else { return verbatim }

        // An SGR with no parameters means "reset everything", so when every
        // parameter has been taken out (a bare `ESC[2m`) emit nothing at all
        // rather than a sequence that would wipe the colours around it.
        var out = kept.isEmpty ? [] : Array("\u{1B}[\(kept.joined(separator: ";"))m".utf8)
        if dim {
            // Our own blend, in place of the attribute the terminal would halve.
            out += Self.trueColorSGR(effectiveDimColor()) ?? []
        } else if wasDim && !reset {
            // Dim off without a full reset: our explicit colour is still in
            // force, so put back what the program actually asked for.
            out += restoreForegroundSGR()
        } else if Self.isLight(background) {
            // Non-dim on a light ground: a program that assumes a dark terminal
            // paints its de-emphasised text — notably the echo of what you just
            // typed — in a pale grey that vanishes on paper. `kept` has already
            // emitted that pale colour; if it can't be read, append a floored
            // version so this last SGR wins. Dark grounds are left alone (a pale
            // colour reads fine there, and dark-on-dark can be intentional).
            let resolved = resolvedForeground()
            let floored = legible(resolved, floor: Self.bodyContrastFloor)
            if floored != resolved, let sgr = Self.trueColorSGR(floored) { out += sgr }
        }
        return out
    }

    /// The foreground as the program last asked for it, in its original form.
    private func restoreForegroundSGR() -> [UInt8] {
        if dim, let blended = Self.trueColorSGR(effectiveDimColor()) { return blended }
        // On a light ground, floor a too-pale foreground so text restored after a
        // rule (or a dim-off) stays legible rather than washing into the paper.
        if Self.isLight(background) {
            let resolved = resolvedForeground()
            let floored = legible(resolved, floor: Self.bodyContrastFloor)
            if floored != resolved, let sgr = Self.trueColorSGR(floored) { return sgr }
        }
        switch foregroundSpec {
        case .default:
            return Array("\u{1B}[39m".utf8)
        case .indexed(let n) where n < 8:
            return Array("\u{1B}[\(30 + n)m".utf8)
        case .indexed(let n) where n < 16:
            return Array("\u{1B}[\(90 + n - 8)m".utf8)
        case .indexed(let n):
            return Array("\u{1B}[38;5;\(n)m".utf8)
        case .rgb(let r, let g, let b):
            return Array("\u{1B}[38;2;\(r);\(g);\(b)m".utf8)
        }
    }

    /// The least contrast dim text keeps against the ground. Dim reads as
    /// secondary, not absent — SwiftTerm's own half-blend, and even our lighter
    /// `dimBlend`, take an already-light colour under legibility on paper (Linen's
    /// `#7C7A71` body slot lands near 2.75:1). Held at 3:1 so it still reads
    /// clearly softer than body text but stays on the page.
    private static let dimContrastFloor: CGFloat = 3.0
    /// The least contrast ordinary (non-dim) text keeps against a light ground, so
    /// the echo of typed input — often painted in a pale, assume-dark-terminal grey
    /// — reads clearly rather than ghosting into the paper.
    private static let bodyContrastFloor: CGFloat = 4.0

    /// A light ground (paper themes) needs the legibility floors; a dark ground
    /// doesn't, and lifting its colours would reveal intentional dark-on-dark marks.
    private static func isLight(_ color: NSColor) -> Bool {
        guard let c = color.usingColorSpace(.sRGB) else { return false }
        let lum = 0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent
        return lum > 0.5
    }

    /// Pull a colour toward the theme ink (the most legible mark on this ground)
    /// only as far as it takes to clear `floor` against the background. A colour
    /// that already clears it is returned untouched, so this can only ever lift a
    /// washed-out colour into legibility — never darken or recolour a clear one.
    private func legible(_ color: NSColor, floor: CGFloat) -> NSColor {
        guard Theme.contrast(color, background) < floor else { return color }
        var low: CGFloat = 0, high: CGFloat = 1   // 0 → color, 1 → ink
        for _ in 0..<16 {
            let mid = (low + high) / 2
            let candidate = color.blended(withFraction: mid, of: foreground) ?? foreground
            if Theme.contrast(candidate, background) < floor { low = mid } else { high = mid }
        }
        return color.blended(withFraction: high, of: foreground) ?? foreground
    }

    /// The current foreground blended toward the ground by `dimBlend`.
    private func effectiveDimColor() -> NSColor {
        let base = resolvedForeground()
        guard let blend = dimBlend else { return base }
        let dimmed = base.blended(withFraction: blend, of: background) ?? base
        if Self.isLight(background) {
            // On paper, dim — or an already-pale base the dim blend can't rescue —
            // washes out. Pull it back toward the ink to a soft floor (below body,
            // so it still reads as secondary) rather than off the page entirely.
            return legible(dimmed, floor: Self.dimContrastFloor)
        }
        // Dark ground: conservative. If the blend has taken it under the floor, ease
        // it back toward the undimmed colour until it clears — but never past `base`,
        // so dim can only ever soften: a near-ground colour a program means to hide
        // (Solarized's `base02`) stays hidden, it isn't lifted into view.
        guard Theme.contrast(dimmed, background) < Self.dimContrastFloor,
              Theme.contrast(base, background) > Self.dimContrastFloor else { return dimmed }
        var low: CGFloat = 0, high: CGFloat = 1   // 0 → dimmed, 1 → base
        for _ in 0..<16 {
            let mid = (low + high) / 2
            let candidate = dimmed.blended(withFraction: mid, of: base) ?? base
            if Theme.contrast(candidate, background) < Self.dimContrastFloor { low = mid } else { high = mid }
        }
        return dimmed.blended(withFraction: high, of: base) ?? base
    }

    /// What the current foreground spec actually looks like in this theme.
    private func resolvedForeground() -> NSColor {
        switch foregroundSpec {
        case .default:
            return foreground
        case .rgb(let r, let g, let b):
            return NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255,
                           blue: CGFloat(b) / 255, alpha: 1)
        case .indexed(let n):
            if n < palette.count { return palette[n] }
            return Self.xterm256(n) ?? foreground
        }
    }

    /// The generated part of the xterm 256-colour table: a 6×6×6 cube, then a
    /// 24-step grey ramp. (0–15 come from the theme's palette.)
    static func xterm256(_ index: Int) -> NSColor? {
        func color(_ r: Int, _ g: Int, _ b: Int) -> NSColor {
            NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255,
                    blue: CGFloat(b) / 255, alpha: 1)
        }
        switch index {
        case 16...231:
            let levels = [0, 95, 135, 175, 215, 255]
            let n = index - 16
            return color(levels[(n / 36) % 6], levels[(n / 6) % 6], levels[n % 6])
        case 232...255:
            let grey = 8 + (index - 232) * 10
            return color(grey, grey, grey)
        default:
            return nil
        }
    }

    private static func trueColorSGR(_ color: NSColor?) -> [UInt8]? {
        guard let rgb = color?.usingColorSpace(.sRGB) else { return nil }
        let channel = { (value: CGFloat) in Int(round(value * 255)) }
        return Array("\u{1B}[38;2;\(channel(rgb.redComponent));\(channel(rgb.greenComponent));\(channel(rgb.blueComponent))m".utf8)
    }
}
