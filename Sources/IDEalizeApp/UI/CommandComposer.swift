import SwiftUI

/// Warp-style command bar pinned to the bottom of the window: a raised, rounded
/// surface with a directory chip, a prompt glyph, the input, and a run
/// affordance. Type a command and press Return to send it to the focused
/// terminal; ↑/↓ recall history. (The terminal still accepts direct typing too.)
struct CommandComposer: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @State private var text = ""
    @State private var historyIndex: Int? = nil
    @FocusState private var focused: Bool

    private var theme: Theme { settings.theme }

    private var history: [String] {
        guard let session = workspace.focusedSession else { return [] }
        var seen = Set<String>(); var out: [String] = []
        for b in session.blocks.reversed() where !seen.contains(b.command) {
            seen.insert(b.command); out.append(b.command)
        }
        return out
    }

    private var cwdLabel: String {
        guard let p = workspace.focusedSession?.projectPath, !p.isEmpty, p != "/" else { return "~" }
        return (p as NSString).lastPathComponent
    }

    /// In a running TUI (Claude) the bar is a chat input; otherwise a command.
    private var inChat: Bool { workspace.focusedSession?.tuiActive ?? false }
    private var placeholder: String { inChat ? "Message Claude…" : "Run a command…" }

    var body: some View {
        HStack(spacing: 11) {
            // Directory chip.
            HStack(spacing: 5) {
                Image(systemName: "folder.fill").font(.system(size: 10))
                Text(cwdLabel).font(settings.ui(11, .medium))
            }
            .foregroundStyle(Color(theme.secondaryForeground))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Capsule().fill(Color(theme.surface)))
            .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))

            Text("›")
                .font(settings.mono(16, .bold))
                .foregroundStyle(Color(theme.accent))

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(settings.mono(14))
                .foregroundStyle(Color(theme.foreground))
                .focused($focused)
                .onSubmit(send)
                .onKeyPress(.upArrow) { recall(1); return .handled }
                .onKeyPress(.downArrow) { recall(-1); return .handled }

            if !text.isEmpty {
                Button(action: send) {
                    Image(systemName: "return")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(settings.actionStyle.fill))
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 13)
                .fill(Color(theme.elevated))
                .overlay(
                    RoundedRectangle(cornerRadius: 13)
                        .strokeBorder(Color(focused ? theme.accent : theme.border),
                                      lineWidth: focused ? 1.5 : 1)
                )
        )
        .padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 12)
    }

    private func send() {
        let cmd = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cmd.isEmpty, let session = workspace.focusedSession else { return }
        session.submitInput(cmd)
        text = ""
        historyIndex = nil
    }

    private func recall(_ delta: Int) {
        let h = history
        guard !h.isEmpty else { return }
        let next: Int
        if let cur = historyIndex { next = cur + delta } else { next = delta > 0 ? 0 : -1 }
        if next < 0 { historyIndex = nil; text = ""; return }
        let clamped = min(next, h.count - 1)
        historyIndex = clamped
        text = h[clamped]
    }
}
