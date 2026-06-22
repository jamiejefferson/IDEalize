import Foundation

/// Builds the escape sequences that render images inline in the terminal grid.
///
/// We adopt the de-facto iTerm2 "1337" inline-image protocol so existing tools
/// (and the `idealize image` subcommand) interoperate. The IDEalize terminal
/// view intercepts OSC 1337 and draws the decoded image as an inline cell block.
///
///   ESC ] 1337 ; File = key=value;... : <base64> BEL
public enum InlineGraphics {
    public struct Options {
        /// Width/height in terminal cells, "auto", pixels ("100px") or percent ("50%").
        public var width: String?
        public var height: String?
        /// Preserve aspect ratio when both dimensions are constrained.
        public var preserveAspectRatio: Bool
        /// Display name shown if the image cannot be rendered.
        public var name: String?
        /// If false the sequence is treated as a file download rather than inline.
        public var inline: Bool

        public init(width: String? = nil,
                    height: String? = nil,
                    preserveAspectRatio: Bool = true,
                    name: String? = nil,
                    inline: Bool = true) {
            self.width = width
            self.height = height
            self.preserveAspectRatio = preserveAspectRatio
            self.name = name
            self.inline = inline
        }
    }

    static let ESC = "\u{1B}"
    static let BEL = "\u{07}"

    /// Encode raw image bytes into an inline-image escape sequence.
    public static func sequence(for data: Data, options: Options = Options()) -> String {
        var args: [String] = []
        args.append("inline=\(options.inline ? 1 : 0)")
        args.append("size=\(data.count)")
        if let w = options.width { args.append("width=\(w)") }
        if let h = options.height { args.append("height=\(h)") }
        args.append("preserveAspectRatio=\(options.preserveAspectRatio ? 1 : 0)")
        if let name = options.name,
           let encoded = name.data(using: .utf8)?.base64EncodedString() {
            args.append("name=\(encoded)")
        }
        let b64 = data.base64EncodedString()
        return "\(ESC)]1337;File=\(args.joined(separator: ";")):\(b64)\(BEL)"
    }

    /// Convenience: build the sequence for a file on disk. Returns nil if unreadable.
    public static func sequence(forFileAt path: String, options: Options = Options()) -> String? {
        let url = URL(fileURLWithPath: path)
        guard let data = try? Data(contentsOf: url) else { return nil }
        var opts = options
        if opts.name == nil { opts.name = url.lastPathComponent }
        return sequence(for: data, options: opts)
    }

    /// Parse the argument portion (between `File=` and `:`) into a dictionary.
    public static func parseArgs(_ argString: String) -> [String: String] {
        var result: [String: String] = [:]
        for pair in argString.split(separator: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { result[kv[0]] = kv[1] }
        }
        return result
    }
}

/// Builds Kitty-graphics-protocol escape sequences. SwiftTerm renders these
/// natively, so this is IDEalize's primary inline-image path.
///
///   ESC _ G <control>;<base64-chunk> ESC \
///
/// The payload must be base64 and split into <=4096-byte chunks; every chunk
/// except the last carries `m=1`.
public enum KittyGraphics {
    static let APC_START = "\u{1B}_"
    static let ST = "\u{1B}\\"
    static let chunkSize = 4096

    /// Encode PNG bytes into a transmit-and-display Kitty sequence.
    /// - Parameters:
    ///   - png: PNG-encoded image bytes (`f=100`).
    ///   - cols: optional display width in terminal cells (`c=`).
    ///   - rows: optional display height in terminal cells (`r=`).
    public static func sequence(png: Data, cols: Int? = nil, rows: Int? = nil) -> String {
        let b64 = png.base64EncodedString()
        let chunks = stride(from: 0, to: b64.count, by: chunkSize).map { start -> Substring in
            let s = b64.index(b64.startIndex, offsetBy: start)
            let e = b64.index(s, offsetBy: min(chunkSize, b64.count - start))
            return b64[s..<e]
        }

        var output = ""
        for (i, chunk) in chunks.enumerated() {
            let isFirst = i == 0
            let isLast = i == chunks.count - 1
            var control: [String] = []
            if isFirst {
                control.append("a=T")   // transmit and display
                control.append("f=100") // PNG
                if let cols { control.append("c=\(cols)") }
                if let rows { control.append("r=\(rows)") }
            }
            control.append("m=\(isLast ? 0 : 1)")
            output += APC_START + "G" + control.joined(separator: ",") + ";" + chunk + ST
        }
        // A trailing newline moves the cursor below the image block.
        return output
    }
}
