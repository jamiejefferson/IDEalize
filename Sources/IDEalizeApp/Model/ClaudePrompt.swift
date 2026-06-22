import Foundation

/// A confirmation / choice prompt Claude Code is showing in the terminal,
/// reconstructed from the visible screen so we can answer it from the chat UI.
struct ClaudePrompt: Equatable {
    var question: String
    var options: [Option]

    /// True when any option carries a checkbox — i.e. Claude is showing a
    /// multi-select that needs toggling + a confirm (Enter), not a single pick.
    var isMultiSelect: Bool { options.contains { $0.checkState != .none } }

    struct Option: Equatable, Identifiable {
        var id: Int { number }
        let number: Int
        let label: String          // clean label (checkbox marker stripped)
        var checkState: CheckState = .none

        enum CheckState { case none, unchecked, checked }
    }
}

enum ClaudePromptParser {
    /// Box-drawing / selector glyphs to strip from a captured line.
    private static let noise = Set("│─╭╮╰╯┌┐└┘├┤┬┴┼┃━╔╗╚╝║═❯▶▸‣→·")

    /// Detect a numbered choice prompt in the visible terminal lines.
    static func parse(_ lines: [String]) -> ClaudePrompt? {
        let cleaned = lines.map { clean($0) }

        var options: [ClaudePrompt.Option] = []
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

        // The question is the closest non-empty, non-option line above the
        // options — prefer one ending in "?".
        var question = ""
        var r = firstRow - 1
        var scanned = 0
        while r >= 0 && scanned < 6 {
            let t = cleaned[r].trimmingCharacters(in: .whitespaces)
            if !t.isEmpty && numberedOption(cleaned[r]) == nil {
                if t.hasSuffix("?") { question = t; break }
                if question.isEmpty { question = t }
            }
            r -= 1; scanned += 1
        }
        // Require a question mark somewhere, or an "esc to cancel"-style footer,
        // to avoid mistaking a plain numbered list for a prompt.
        let hasFooter = cleaned.contains { l in
            let lower = l.lowercased()
            return lower.contains("esc to") || lower.contains("to proceed") || lower.contains("to confirm")
        }
        guard question.hasSuffix("?") || hasFooter else { return nil }
        if question.isEmpty { question = "Claude needs your input" }

        return ClaudePrompt(question: question, options: options)
    }

    /// Lift Claude's working status line ("… · ↑ 31.9k tokens") and current tip
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

    /// Parse "1. Yes" / "2) No, and tell Claude…" → (number, label).
    private static func numberedOption(_ line: String) -> ClaudePrompt.Option? {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard let sep = t.firstIndex(where: { $0 == "." || $0 == ")" }) else { return nil }
        let numStr = t[t.startIndex..<sep].trimmingCharacters(in: .whitespaces)
        guard numStr.count <= 1, let n = Int(numStr), n >= 1, n <= 9 else { return nil }
        let raw = t[t.index(after: sep)...].trimmingCharacters(in: .whitespaces)
        let (state, label) = parseCheckbox(raw)
        guard label.count >= 1, label.count < 120 else { return nil }
        return ClaudePrompt.Option(number: n, label: label, checkState: state)
    }

    /// Detect a leading checkbox marker ("[✔] Calendar" → checked, "Calendar").
    private static func parseCheckbox(_ s: String) -> (ClaudePrompt.Option.CheckState, String) {
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
