import SwiftUI

/// The one place the app's keyboard shortcuts are written down as data. Both
/// surfaces that show them — the floating ⌘/ sheet and Settings ▸ Keybinds —
/// read this catalogue, so a shortcut added to the menus only needs listing
/// here once to appear in both.
enum ShortcutCatalog {
    struct Group {
        let title: String
        let items: [(action: String, keys: String)]
    }

    static let groups: [Group] = [
        Group(title: "Sessions & Chats", items: [
            ("New session (pick a folder)", "⌘T"),
            ("New session in Home", "⇧⌘T"),
            ("New project", "⇧⌘N"),
            ("Next / previous session", "⇧⌘] · ⇧⌘["),
            ("Go straight to chat 1–9", "⌘1 – ⌘9"),
            ("Archive chat", "⇧⌘⌫"),
            ("Open / close project agent", "⇧⌘A"),
        ]),
        Group(title: "Panes & Terminal", items: [
            ("Split right / split down", "⌘D · ⇧⌘D"),
            ("Close pane", "⌘W"),
            ("Toggle chat / terminal", "⌘J"),
            ("Focus the message input", "⌘I"),
            ("Copy last command", "⇧⌘C"),
            ("Re-run last command", "⌃R"),
        ]),
        Group(title: "Panels & Views", items: [
            ("Command palette", "⌘P"),
            ("Sessions rail", "⇧⌘R"),
            ("File explorer", "⇧⌘E"),
            ("Document panel", "⇧⌘V"),
            ("Blocks sidebar", "⌘B"),
            ("Command composer", "⌘L"),
            ("Appearance panel", "⌥⌘A"),
            ("Mini mode", "⌃⌥M"),
        ]),
        Group(title: "Text & App", items: [
            ("Bigger / smaller terminal font", "⌘= · ⌘−"),
            ("Default terminal font size", "⌘0"),
            ("Save document (document panel)", "⌘S"),
            ("Settings", "⌘,"),
            ("Keyboard shortcuts overlay", "⌘/"),
        ]),
    ]
}

/// The at-a-glance keyboard shortcut reference — Help ▸ Keyboard Shortcuts (⌘/).
/// A plain static list, grouped the way the menus are, so the whole map can be
/// read in one place without opening every menu. Every shortcut here is also a
/// real menu item (that's what makes it work); this sheet is just the overview.
/// The same catalogue backs Settings ▸ Keybinds.
struct ShortcutsHelpView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Keyboard Shortcuts")
                    .font(settings.ui(15, .semibold))
                    .foregroundStyle(Color(theme.foreground))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            Rectangle().fill(Color(theme.border)).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(ShortcutCatalog.groups, id: \.title) { group in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(group.title.uppercased())
                                .font(settings.ui(10, .semibold))
                                .foregroundStyle(Color(theme.secondaryForeground))
                                .kerning(0.6)
                                .padding(.bottom, 2)
                            ForEach(group.items, id: \.action) { item in
                                row(item.action, item.keys)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .frame(width: 420, height: 540)
        .background(Color(theme.background))
    }

    /// One action → keys line. The key caps are informational (static), so they
    /// sit in the neutral surface + text colours, not the highlight.
    private func row(_ action: String, _ keys: String) -> some View {
        HStack(spacing: 10) {
            Text(action)
                .font(settings.ui(12))
                .foregroundStyle(Color(theme.foreground))
            Spacer(minLength: 12)
            Text(keys)
                .font(settings.ui(11, .medium))
                .foregroundStyle(Color(theme.secondaryForeground))
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 5).fill(Color(theme.surface)))
                .overlay(RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(Color(theme.border).opacity(0.7), lineWidth: 1))
        }
    }
}
