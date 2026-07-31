import Foundation

struct MarkdownHeading: Identifiable {
    let level: Int
    let title: String
    let lineIndex: Int

    var id: String { "\(lineIndex)-\(level)-\(title)" }
}

struct MarkdownOutline {
    let headings: [MarkdownHeading]

    static func parse(_ text: String) -> MarkdownOutline {
        var headings: [MarkdownHeading] = []
        let lines = text.components(separatedBy: "\n")

        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#") {
                if let level = extractHeadingLevel(trimmed) {
                    let title = trimmed.dropFirst(level).trimmingCharacters(in: .whitespaces)
                    headings.append(MarkdownHeading(
                        level: level,
                        title: String(title),
                        lineIndex: index
                    ))
                }
            }
        }

        return MarkdownOutline(headings: headings)
    }

    private static func extractHeadingLevel(_ line: String) -> Int? {
        guard line.hasPrefix("#") else { return nil }
        let hashes = line.prefix(while: { $0 == "#" }).count
        guard hashes >= 1 && hashes <= 6 else { return nil }
        guard line.dropFirst(hashes).hasPrefix(" ") else { return nil }
        return hashes
    }
}
