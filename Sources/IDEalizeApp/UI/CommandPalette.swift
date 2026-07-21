import SwiftUI

/// One selectable entry in the command palette.
struct PaletteAction: Identifiable {
    let id = UUID()
    let title: String
    var subtitle: String?
    var systemImage: String
    var category: String
    let perform: () -> Void
}

/// Warp-style fuzzy command palette (⌘P). Lists app actions, themes, workflows,
/// recent commands, and open terminals.
struct CommandPalette: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject var settings: AppSettings
    @ObservedObject var workflowStore: WorkflowStore

    @State private var query = ""
    @State private var selection = 0
    /// The action catalog. Built once when the palette appears — building it
    /// assigns fresh UUIDs, so rebuilding per keystroke churned every row's
    /// identity in addition to re-scanning workflows/history/sessions.
    @State private var actions: [PaletteAction] = []
    @FocusState private var fieldFocused: Bool

    private var filtered: [PaletteAction] {
        if query.isEmpty { return actions }
        return actions
            .compactMap { a -> (PaletteAction, Int)? in
                let hay = a.title + " " + (a.subtitle ?? "") + " " + a.category
                guard let s = FuzzyMatch.score(query: query, text: hay) else { return nil }
                return (a, s)
            }
            .sorted { $0.1 > $1.1 }
            .map { $0.0 }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search actions, workflows, history…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .focused($fieldFocused)
                    .onChange(of: query) { selection = 0 }
                    .onSubmit { runSelected() }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, action in
                            PaletteRow(action: action, selected: idx == selection)
                                .id(idx)
                                .contentShape(Rectangle())
                                .onTapGesture { selection = idx; runSelected() }
                        }
                    }
                }
                .frame(maxHeight: 360)
                .onChange(of: selection) { proxy.scrollTo(selection, anchor: .center) }
            }
        }
        .frame(width: 560)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.08)))
        .shadow(radius: 30, y: 10)
        .onAppear {
            fieldFocused = true
            actions = buildActions()
        }
        .onKeyPress(.downArrow) { move(1); return .handled }
        .onKeyPress(.upArrow) { move(-1); return .handled }
        .onKeyPress(.escape) { workspace.showCommandPalette = false; return .handled }
        .onKeyPress(.return) { runSelected(); return .handled }
    }

    private func move(_ delta: Int) {
        guard !filtered.isEmpty else { return }
        selection = (selection + delta + filtered.count) % filtered.count
    }

    private func runSelected() {
        guard filtered.indices.contains(selection) else { return }
        let action = filtered[selection]
        workspace.showCommandPalette = false
        action.perform()
    }

    // MARK: - Action catalog

    private func buildActions() -> [PaletteAction] {
        var result: [PaletteAction] = []

        // App actions.
        result += [
            PaletteAction(title: "New Terminal Tab", systemImage: "plus.square", category: "Terminal") { workspace.newTab() },
            PaletteAction(title: "Split Right", systemImage: "rectangle.righthalf.inset.filled", category: "Terminal") { workspace.splitFocused(axis: .horizontal) },
            PaletteAction(title: "Split Down", systemImage: "rectangle.bottomhalf.inset.filled", category: "Terminal") { workspace.splitFocused(axis: .vertical) },
            PaletteAction(title: "Toggle Blocks Sidebar", systemImage: "sidebar.right", category: "View") { workspace.showSidebar.toggle() },
            PaletteAction(title: "Close Pane", systemImage: "xmark.square", category: "Terminal") {
                if let s = workspace.focusedSession { workspace.closeSession(s) }
            },
        ]

        // Themes.
        for theme in Theme.all {
            result.append(PaletteAction(title: "Theme: \(theme.name)",
                                        systemImage: "paintpalette",
                                        category: "Theme") {
                settings.themeName = theme.name
                workspace.reapplyAppearance()
            })
        }

        // Workflows.
        for wf in workflowStore.workflows {
            result.append(PaletteAction(title: wf.name,
                                        subtitle: wf.description ?? wf.command,
                                        systemImage: "wand.and.stars",
                                        category: "Workflow") {
                workspace.execute(workflow: wf)
            })
        }

        // Recent commands from the focused session (most recent first, deduped).
        if let session = workspace.focusedSession {
            var seen = Set<String>()
            for block in session.blocks.reversed() {
                guard !seen.contains(block.command) else { continue }
                seen.insert(block.command)
                let cmd = block.command
                result.append(PaletteAction(title: cmd,
                                            subtitle: "Re-run",
                                            systemImage: "clock.arrow.circlepath",
                                            category: "History") {
                    session.rerun(cmd)
                })
                if seen.count >= 30 { break }
            }
        }

        // Jump to a session.
        for s in workspace.allSessions where s.id != workspace.focusedSessionID {
            result.append(PaletteAction(title: "Go to \(s.label)",
                                        subtitle: s.id,
                                        systemImage: "arrow.right.circle",
                                        category: "Session") {
                workspace.focusSession(s.id)
            })
        }

        return result
    }
}

private struct PaletteRow: View {
    let action: PaletteAction
    let selected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: action.systemImage)
                .frame(width: 20)
                .foregroundStyle(selected ? Color.white : Color.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(action.title).lineLimit(1)
                    .foregroundStyle(selected ? Color.white : Color.primary)
                if let sub = action.subtitle {
                    Text(sub).font(.caption).lineLimit(1)
                        .foregroundStyle(selected ? Color.white.opacity(0.8) : Color.secondary)
                }
            }
            Spacer()
            Text(action.category).font(.caption2)
                .foregroundStyle(selected ? Color.white.opacity(0.8) : Color.secondary)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Capsule().fill(selected ? Color.white.opacity(0.2) : Color.gray.opacity(0.15)))
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(selected ? Color.accentColor : Color.clear)
    }
}
