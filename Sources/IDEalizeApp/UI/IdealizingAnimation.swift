import SwiftUI

/// The "working" indicator: the word "Idealizing" where each letter constantly
/// re-randomises its font weight, design (serif/rounded/mono), italic, outline
/// and colour — a lively typographic shimmer while Claude works.
struct IdealizingAnimation: View {
    var size: CGFloat = 18
    @ObservedObject private var settings = AppSettings.shared
    @State private var styles: [LetterStyle] = []
    private let word = Array("Idealizing")
    private let timer = Timer.publish(every: 0.28, on: .main, in: .common).autoconnect()

    private var theme: Theme { settings.theme }

    struct LetterStyle {
        var weight: Font.Weight
        var design: Font.Design
        var italic: Bool
        var outline: Bool
        var accent: Bool
        var jitter: CGFloat
    }

    var body: some View {
        HStack(spacing: 1) {
            ForEach(Array(word.enumerated()), id: \.offset) { i, ch in
                letter(ch, styles.indices.contains(i) ? styles[i] : .plain)
            }
        }
        .animation(.easeInOut(duration: 0.26), value: styles.map(\.jitter))
        .onAppear { if styles.isEmpty { randomize() } }
        .onReceive(timer) { _ in randomize() }
    }

    @ViewBuilder
    private func letter(_ ch: Character, _ s: LetterStyle) -> some View {
        // Monochrome: every letter uses the foreground colour.
        let color = Color(theme.foreground)
        // "Outline" is approximated as a hollow, dimmed glyph behind a thin copy.
        Text(String(ch))
            .font(font(s))
            .foregroundStyle(s.outline ? color.opacity(0.45) : color)
            .baselineOffset(s.jitter)
            .overlay {
                if s.outline {
                    Text(String(ch))
                        .font(.system(size: size, weight: .ultraLight, design: s.design))
                        .foregroundStyle(color)
                        .baselineOffset(s.jitter)
                }
            }
    }

    private func font(_ s: LetterStyle) -> Font {
        var f = Font.system(size: size, weight: s.outline ? .ultraLight : s.weight, design: s.design)
        if s.italic { f = f.italic() }
        return f
    }

    private func randomize() {
        let weights: [Font.Weight] = [.ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black]
        let designs: [Font.Design] = [.default, .serif, .rounded, .monospaced]
        styles = word.map { _ in
            LetterStyle(weight: weights.randomElement() ?? .regular,
                        design: designs.randomElement() ?? .default,
                        italic: Bool.random(),
                        outline: Int.random(in: 0..<5) == 0,
                        accent: Int.random(in: 0..<4) == 0,
                        jitter: CGFloat.random(in: -1.5...1.5))
        }
    }
}

extension IdealizingAnimation.LetterStyle {
    static let plain = IdealizingAnimation.LetterStyle(
        weight: .regular, design: .default, italic: false, outline: false, accent: false, jitter: 0)
}
