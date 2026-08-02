import Foundation

struct MarkdownHeading: Identifiable {
    let level: Int
    let title: String
    let lineIndex: Int

    var id: String { "\(lineIndex)-\(level)-\(title)" }
}

/// The ATX headings of a markdown document, in document order, for the document
/// panel's navigation sidebar.
struct MarkdownOutline {
    let headings: [MarkdownHeading]

    static func parse(_ text: String) -> MarkdownOutline {
        var headings: [MarkdownHeading] = []
        let lines = text.components(separatedBy: "\n")
        /// The fence that opened the code block we're inside, if any. Lines in a
        /// code block are content, not structure: a shell snippet's `# install
        /// deps` is a comment, and listing it as a heading fills the outline
        /// with entries that jump nowhere useful.
        var openFence: (marker: Character, length: Int)?

        for (index, line) in lines.enumerated() {
            if let fence = codeFence(line) {
                if let open = openFence {
                    // Only a fence of the same kind, and at least as long, closes.
                    if fence.marker == open.marker && fence.length >= open.length {
                        openFence = nil
                    }
                } else {
                    openFence = fence
                }
                continue
            }
            guard openFence == nil else { continue }

            if let (level, title) = heading(line) {
                headings.append(MarkdownHeading(level: level, title: title, lineIndex: index))
            }
        }

        return MarkdownOutline(headings: headings)
    }

    /// A ``` or ~~~ fence, with its run length — a longer fence can be closed
    /// only by one at least as long.
    private static func codeFence(_ line: String) -> (marker: Character, length: Int)? {
        let trimmed = line.drop(while: { $0 == " " })
        guard let first = trimmed.first, first == "`" || first == "~" else { return nil }
        let run = trimmed.prefix(while: { $0 == first }).count
        guard run >= 3 else { return nil }
        return (first, run)
    }

    /// An ATX heading: up to three leading spaces, one to six `#`, then a space.
    /// Deeper indentation is a code block, and `#tag` with no space is not a
    /// heading — both would otherwise show up in the outline.
    private static func heading(_ line: String) -> (level: Int, title: String)? {
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        guard leadingSpaces <= 3 else { return nil }
        let body = line.dropFirst(leadingSpaces)
        let hashes = body.prefix(while: { $0 == "#" }).count
        guard hashes >= 1 && hashes <= 6 else { return nil }

        let rest = body.dropFirst(hashes)
        // "# Title" is a heading; "#Title" is not. A bare "#" is an empty one.
        guard rest.isEmpty || rest.first == " " || rest.first == "\t" else { return nil }

        var title = rest.trimmingCharacters(in: .whitespaces)
        // Strip an optional closing sequence: "## Title ##".
        if title.hasSuffix("#") {
            let withoutClosing = String(title.reversed().drop(while: { $0 == "#" }).reversed())
            if withoutClosing.isEmpty || withoutClosing.hasSuffix(" ") {
                title = withoutClosing.trimmingCharacters(in: .whitespaces)
            }
        }
        return (hashes, title)
    }
}
