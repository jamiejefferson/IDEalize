import Foundation

/// Lightweight fuzzy subsequence matcher for the command palette.
enum FuzzyMatch {
    /// Returns a score if `query` is a subsequence of `text` (case-insensitive),
    /// else nil. Higher is better. Rewards consecutive matches and word-start hits.
    static func score(query: String, text: String) -> Int? {
        if query.isEmpty { return 0 }
        let q = Array(query.lowercased())
        let t = Array(text.lowercased())
        let original = Array(text)
        var qi = 0
        var score = 0
        var lastMatch = -2
        for (ti, ch) in t.enumerated() {
            guard qi < q.count else { break }
            if ch == q[qi] {
                var bonus = 1
                if ti == lastMatch + 1 { bonus += 3 }                 // consecutive
                if ti == 0 || !original[ti - 1].isLetter { bonus += 5 } // word start
                score += bonus
                lastMatch = ti
                qi += 1
            }
        }
        return qi == q.count ? score : nil
    }
}
