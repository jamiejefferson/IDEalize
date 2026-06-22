import AppKit
import SwiftTerm

/// Renders captured command-output bytes into a colored attributed string by
/// replaying them through a headless SwiftTerm `Terminal` (so cursor moves,
/// `\r` overwrites, colors and styles all resolve correctly) and reading back
/// the resulting grid.
enum BlockRenderer {
    /// Silent delegate for the headless terminal.
    private final class NullDelegate: TerminalDelegate {
        func send(source: Terminal, data: ArraySlice<UInt8>) {}
    }
    private static let nullDelegate = NullDelegate()

    struct Result {
        let attributed: NSAttributedString
        let lineCount: Int
    }

    static func render(bytes: [UInt8], cols: Int, font: NSFont, theme: Theme) -> Result {
        let safeCols = max(20, min(cols, 400))
        let options = TerminalOptions(cols: safeCols, rows: 24, scrollback: 6000)
        let terminal = Terminal(delegate: nullDelegate, options: options)
        // Cap to avoid pathological memory use on huge dumps.
        let capped = bytes.count > 600_000 ? Array(bytes.suffix(600_000)) : bytes
        terminal.feed(buffer: capped[...])

        let cursor = terminal.getCursorLocation()
        let top = terminal.getTopVisibleRow()
        let lastAbs = max(0, top + cursor.y)

        let result = NSMutableAttributedString()
        let boldFont = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
        var renderedLines = 0
        // Defer trailing blank lines so we don't pad the card with empty rows.
        var pendingBlankLines = 0

        for absRow in 0...lastAbs {
            guard let line = terminal.getScrollInvariantLine(row: absRow) else { continue }
            let lineStr = lineAttributed(line, font: font, boldFont: boldFont, theme: theme)
            if lineStr.length == 0 {
                pendingBlankLines += 1
                continue
            }
            while pendingBlankLines > 0 {
                result.append(NSAttributedString(string: "\n"))
                pendingBlankLines -= 1
                renderedLines += 1
            }
            if renderedLines > 0 { result.append(NSAttributedString(string: "\n")) }
            result.append(lineStr)
            renderedLines += 1
        }
        return Result(attributed: result, lineCount: max(1, renderedLines))
    }

    private static func lineAttributed(_ line: BufferLine, font: NSFont, boldFont: NSFont, theme: Theme) -> NSAttributedString {
        // Find last non-blank column to trim trailing spaces.
        var lastCol = -1
        for col in 0..<line.count {
            let cd = line[col]
            let ch = cd.getCharacter()
            if ch != " " && ch != "\u{0}" { lastCol = col }
        }
        if lastCol < 0 { return NSAttributedString() }

        let out = NSMutableAttributedString()
        for col in 0...lastCol {
            let cd = line[col]
            var ch = cd.getCharacter()
            if ch == "\u{0}" { ch = " " }
            let attr = cd.attribute
            let bold = attr.style.contains(.bold)
            var color = AnsiColor.foreground(attr.fg, theme: theme)
            if attr.style.contains(.inverse) {
                color = AnsiColor.foreground(attr.bg, theme: theme)
            }
            var attrs: [NSAttributedString.Key: Any] = [
                .font: bold ? boldFont : font,
                .foregroundColor: color,
            ]
            if let bg = AnsiColor.background(attr.bg, theme: theme), !attr.style.contains(.inverse) {
                attrs[.backgroundColor] = bg
            }
            if attr.style.contains(.underline) {
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            out.append(NSAttributedString(string: String(ch), attributes: attrs))
        }
        return out
    }
}
