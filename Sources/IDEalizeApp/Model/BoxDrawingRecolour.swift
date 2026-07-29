import AppKit
import Foundation

/// Repaints box-drawing characters (U+2500–U+257F) in a colour of our choosing
/// as they pass through the PTY stream, whatever colour the program asked for.
///
/// Those characters are the rules an agent frames its prompt box with, and the
/// glyph is the only part of that frame we can single out. A program names its
/// colours either from the shared 16-colour palette — which its own body text
/// draws from too, so dimming a slot dims the transcript with it — or in fixed
/// 24-bit values we don't own at all. Claude Code's light theme rules its box in
/// #888888 while writing its text in #999999, so the frame lands *heavier* than
/// the words inside it. Recolouring by glyph lets the frame sit back without
/// touching a character of text.
///
/// This runs on every byte the terminal receives, so the no-op path allocates
/// nothing: a chunk without `0xE2` in it can't contain one of these characters
/// and is waved straight through.
struct BoxDrawingRecolour {
    /// `ESC [ 38 ; 2 ; r ; g ; b m`, or nil to pass everything through.
    private var setColor: [UInt8]?
    /// `ESC [ 39 m` — back to the default foreground after a run of rules.
    private static let reset: [UInt8] = Array("\u{1B}[39m".utf8)
    /// Up to two bytes of a UTF-8 sequence that straddled the end of a chunk.
    private var carry: [UInt8] = []

    var color: NSColor? {
        didSet { setColor = Self.sgr(for: color) }
    }

    init(color: NSColor? = nil) {
        self.color = color
        self.setColor = Self.sgr(for: color)
    }

    private static func sgr(for color: NSColor?) -> [UInt8]? {
        guard let rgb = color?.usingColorSpace(.sRGB) else { return nil }
        let channel = { (value: CGFloat) in Int(round(value * 255)) }
        return Array("\u{1B}[38;2;\(channel(rgb.redComponent));\(channel(rgb.greenComponent));\(channel(rgb.blueComponent))m".utf8)
    }

    /// The chunk with every run of box-drawing characters wrapped in the colour,
    /// or nil when there's nothing to change and the original can be used as-is.
    ///
    /// In UTF-8 the block is `E2 94 80…BF` and `E2 95 80…BF`. A sequence can
    /// straddle a read boundary, so a partial tail is held back and prepended to
    /// the next chunk — missing one would leave a single cell of a rule in the
    /// program's own colour, which is exactly the kind of speck that reads as a
    /// rendering bug.
    mutating func process(_ slice: ArraySlice<UInt8>) -> [UInt8]? {
        guard let setColor else {
            carry.removeAll(keepingCapacity: true)
            return nil
        }
        guard !carry.isEmpty || slice.contains(0xE2) else { return nil }

        let input: [UInt8] = carry.isEmpty ? Array(slice) : carry + slice
        carry.removeAll(keepingCapacity: true)

        var out: [UInt8] = []
        out.reserveCapacity(input.count + 64)
        var inRun = false
        var index = 0
        while index < input.count {
            let byte = input[index]
            if byte == 0xE2 {
                guard index + 2 < input.count else {
                    carry = Array(input[index...])
                    break
                }
                let second = input[index + 1], third = input[index + 2]
                if second == 0x94 || second == 0x95, (0x80...0xBF).contains(third) {
                    if !inRun {
                        out.append(contentsOf: setColor)
                        inRun = true
                    }
                    out.append(byte); out.append(second); out.append(third)
                    index += 3
                    continue
                }
            }
            if inRun {
                out.append(contentsOf: Self.reset)
                inRun = false
            }
            out.append(byte)
            index += 1
        }
        // Never leave the colour set across a chunk boundary.
        if inRun { out.append(contentsOf: Self.reset) }
        return out
    }
}
