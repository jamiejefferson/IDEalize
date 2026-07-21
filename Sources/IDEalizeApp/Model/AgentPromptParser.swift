import Foundation

/// Detects numbered choice prompts and status lines on the visible terminal.
/// Originally written for Claude Code; reused as the generic parser for agents
/// that render similar interactive prompts.
enum AgentPromptParser {
    /// Box-drawing / selector glyphs to strip from a captured line.
    private static let noise = Set("│─╭╮╰╯┌┐└┘├┤┬┴┼┃━╔╗╚╝║═❯▶▸‣→·")

    /// Detect a numbered choice prompt in the visible terminal lines.
    static func parse(_ lines: [String]) -> AgentPrompt? {
        let cleaned = lines.map { clean($0) }

        var options: [AgentPrompt.Option] = []
        var firstOptionRow: Int?
        for (i, line) in cleaned.enumerated() {
            if let opt = numberedOption(line) {
                if firstOptionRow == nil { firstOptionRow = i }
                options.append(opt)
            }
        }
        // Need at least a Yes/No-style choice, numbered from 1 upward.
        guard options.count >= 2,
              options.first?.number == 1,
              let firstRow = firstOptionRow else { return nil }

        // Reconstruct the question. The agent soft-wraps a long question across
        // several rows, so join the whole block of non-empty lines directly
        // above the first option (top-to-bottom) instead of keeping only the
        // last fragment. The block is bounded by a blank line — or by the top
        // border of a preview box, which clean() flattens to blank.
        var block: [String] = []
        var r = firstRow - 1
        var scanned = 0
        while r >= 0 && scanned < 8 {
            if numberedOption(cleaned[r]) != nil { break }
            let t = cleaned[r].trimmingCharacters(in: .whitespaces)
            if t.isEmpty {
                if !block.isEmpty { break }   // reached the top of the block
            } else {
                block.append(t)
            }
            r -= 1; scanned += 1
        }
        var question = block.reversed().joined(separator: " ")
        question = question.split(separator: " ").joined(separator: " ")  // collapse gaps
        // Drop any trailing context that follows the question itself.
        if let lastMark = question.lastIndex(of: "?") {
            question = String(question[...lastMark])
        }
        // Require a question mark somewhere, or an "esc to cancel"-style footer,
        // to avoid mistaking a plain numbered list for a prompt.
        let hasFooter = cleaned.contains { l in
            let lower = l.lowercased()
            return lower.contains("esc to") || lower.contains("to proceed") || lower.contains("to confirm")
        }
        guard question.hasSuffix("?") || hasFooter else { return nil }
        if question.isEmpty { question = "Agent needs your input" }

        return AgentPrompt(question: question, options: options)
    }

    /// Lift a working status line ("… · ↑ 31.9k tokens") and current tip
    /// ("Tip: Use /btw …") from the visible screen.
    static func statusAndTip(_ lines: [String]) -> (status: String?, tip: String?) {
        var status: String?
        var tip: String?
        for raw in lines {
            let l = clean(raw).trimmingCharacters(in: .whitespaces)
            if status == nil, l.contains("tokens") {
                status = extractStatus(l)
            }
            if tip == nil, let r = l.range(of: "Tip:") {
                let t = l[r.lowerBound...].trimmingCharacters(in: .whitespaces)
                if t.count > 5 { tip = t }
            }
        }
        return (status, tip)
    }

    /// Pull the "<time> · ↑ <n> tokens" chunk out of a status line.
    private static func extractStatus(_ l: String) -> String? {
        // Prefer the parenthetical that contains "tokens".
        if let open = l.lastIndex(of: "("),
           let tokRange = l.range(of: "tokens", range: open..<l.endIndex) {
            var s = String(l[l.index(after: open)..<tokRange.upperBound])
            s = s.replacingOccurrences(of: "esc to interrupt", with: "")
            s = s.trimmingCharacters(in: CharacterSet(charactersIn: " ·-—|"))
            return s.isEmpty ? nil : s
        }
        // Otherwise from the first digit through "tokens".
        if let firstDigit = l.firstIndex(where: { $0.isNumber }),
           let tokRange = l.range(of: "tokens", range: firstDigit..<l.endIndex) {
            return String(l[firstDigit..<tokRange.upperBound]).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    private static func clean(_ line: String) -> String {
        String(String.UnicodeScalarView(line.unicodeScalars.map {
            noise.contains(Character($0)) ? " " : $0
        }))
    }

    /// Parse "1. Yes" / "2) No, and tell the agent…" → (number, label).
    private static func numberedOption(_ line: String) -> AgentPrompt.Option? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard let sep = t.firstIndex(where: { $0 == "." || $0 == ")" }) else { return nil }
        let numStr = t[t.startIndex..<sep].trimmingCharacters(in: .whitespaces)
        guard numStr.count <= 1, let n = Int(numStr), n >= 1, n <= 9 else { return nil }
        let raw = t[t.index(after: sep)...].trimmingCharacters(in: .whitespaces)
        let (state, body) = parseCheckbox(raw)
        let label = stripPreviewColumn(body)
        guard label.count >= 1, label.count < 120 else { return nil }
        return AgentPrompt.Option(number: n, label: label, checkState: state)
    }

    /// Strip a trailing preview/illustration column from an option label. In the
    /// AskUserQuestion preview layout the option list and a right-hand preview
    /// panel share the same terminal rows, fenced by a box rule that clean()
    /// flattens to a wide run of spaces — so the preview text ("Vault/ …",
    /// "00-PROJECT-OVERVIEW.md") otherwise leaks into the label. Cut at the first
    /// 3+-space gap that still has text after it. A real label is a single short
    /// phrase and never contains such a gap; trailing padding has no text after
    /// it and is simply trimmed.
    private static func stripPreviewColumn(_ s: String) -> String {
        guard let gap = s.range(of: "   ") else { return s }
        if s[gap.upperBound...].contains(where: { !$0.isWhitespace }) {
            return String(s[s.startIndex..<gap.lowerBound]).trimmingCharacters(in: .whitespaces)
        }
        return s
    }

    /// Detect a leading checkbox marker ("[✔] Calendar" → checked, "Calendar").
    private static func parseCheckbox(_ s: String) -> (AgentPrompt.Option.CheckState, String) {
        let checked = ["[✔]", "[✓]", "[x]", "[X]", "[●]", "[•]"]
        let unchecked = ["[ ]", "[]", "[○]"]
        for m in checked where s.hasPrefix(m) {
            return (.checked, String(s.dropFirst(m.count)).trimmingCharacters(in: .whitespaces))
        }
        for m in unchecked where s.hasPrefix(m) {
            return (.unchecked, String(s.dropFirst(m.count)).trimmingCharacters(in: .whitespaces))
        }
        return (.none, s)
    }
}
