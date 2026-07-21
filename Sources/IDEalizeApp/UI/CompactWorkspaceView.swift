import SwiftUI

/// The compact, mobile-style layout used when the window is docked to a narrow
/// column (mini-mode, spec §5.3–5.6). One thing is on screen at a time — the
/// current chat, or one secondary panel — chosen from a bottom navigation bar,
/// with a slim header carrying a chat switcher and the exit control.
///
/// Panels *replace* the chat rather than overlaying it: a SwiftUI ScrollView
/// layered over the live terminal NSView loses the scroll wheel to SwiftTerm
/// (see the AppearancePanel note in `WorkspaceView`). Swapping the content out
/// entirely means no terminal ever sits beneath a panel, so every panel scrolls.
struct CompactWorkspaceView: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @State private var active: MiniTab = .chat

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            header
            AnnouncementBanner()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            MiniTabBar(active: $active, workspace: workspace)
        }
        .background(Color(theme.background))
        // Opening a file (from the explorer or elsewhere) or the Appearance
        // inspector surfaces that panel; closing it returns to the chat.
        .onChange(of: workspace.showViewer) {
            if workspace.showViewer { withAnimation(nav) { active = .viewer } }
            else if active == .viewer { withAnimation(nav) { active = .chat } }
        }
        .onChange(of: workspace.showAppearance) {
            if workspace.showAppearance { withAnimation(nav) { active = .appearance } }
            else if active == .appearance { withAnimation(nav) { active = .chat } }
        }
    }

    private let nav = Animation.easeOut(duration: 0.22)

    // MARK: - Header (drag strip + chat switcher + exit)

    private var header: some View {
        VStack(spacing: 0) {
            // A slim strip that clears the traffic lights and drags the window,
            // mirroring the desktop title bar.
            Color(theme.chrome)
                .frame(height: 28)
                .overlay(WindowDragBar())
            HStack(spacing: 6) {
                chatSwitcher
                Spacer(minLength: 4)
                Button {
                    MiniModeManager.shared.toggle()
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .frame(width: 28, height: 24)
                }
                .buttonStyle(.iconHover)
                .help("Exit mini-mode (⌃⌥M)")
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
        .background(Color(theme.chrome))
        .overlay(alignment: .bottom) { Rectangle().fill(Color(theme.border)).frame(height: 1) }
    }

    /// Current chat, tappable to jump to any other chat (spec §5.4).
    private var chatSwitcher: some View {
        Menu {
            ForEach(workspace.projectGroups) { group in
                Section(group.displayName) {
                    ForEach(Array(group.tabs.enumerated()), id: \.element.id) { idx, tab in
                        Button {
                            select(tab)
                        } label: {
                            if workspace.selectedTabID == tab.id {
                                Label(workspace.chatLabel(tab, index: idx), systemImage: "checkmark")
                            } else {
                                Text(workspace.chatLabel(tab, index: idx))
                            }
                        }
                    }
                }
            }
            Divider()
            Button {
                _ = workspace.newTab()
                withAnimation(nav) { active = .chat }
            } label: {
                Label("New Chat", systemImage: "plus")
            }
        } label: {
            HStack(spacing: 4) {
                Text(currentChatName)
                    .font(settings.ui(13, .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(Color(theme.foreground))
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private var currentChatName: String {
        guard let tab = workspace.selectedTab else { return "IDEalize" }
        let idx = workspace.tabs.filter { workspace.projectKey(for: $0) == workspace.projectKey(for: tab) }
            .firstIndex(where: { $0.id == tab.id }) ?? 0
        return workspace.chatLabel(tab, index: idx)
    }

    private func select(_ tab: WorkspaceTab) {
        workspace.selectedTabID = tab.id
        if let s = tab.sessions.first { workspace.focusSession(s.id) }
        withAnimation(nav) { active = .chat }
    }

    // MARK: - Content (one view at a time)

    @ViewBuilder private var content: some View {
        panel
            .id(active)
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .opacity))
    }

    @ViewBuilder private var panel: some View {
        switch active {
        case .chat:
            if let session = workspace.focusedSession {
                LeafPaneView(session: session, workspace: workspace).id(session.id)
            } else {
                EmptyState(workspace: workspace)
            }
        case .sessions:
            SessionRail(workspace: workspace)
        case .files:
            FileExplorerPanel(workspace: workspace)
        case .viewer:
            FileViewerPanel(workspace: workspace)
        case .appearance:
            AppearancePanel(workspace: workspace, compact: true)
        }
    }
}

/// The five destinations reachable in the compact layout.
enum MiniTab: String, Identifiable, CaseIterable {
    case chat, sessions, files, viewer, appearance
    var id: String { rawValue }

    var icon: String {
        switch self {
        case .chat:       return "bubble.left.and.bubble.right"
        case .sessions:   return "list.bullet"
        case .files:      return "folder"
        case .viewer:     return "doc.text"
        case .appearance: return "paintpalette"
        }
    }

    var label: String {
        switch self {
        case .chat:       return "Chat"
        case .sessions:   return "Chats"
        case .files:      return "Files"
        case .viewer:     return "Doc"
        case .appearance: return "Style"
        }
    }
}

/// Mobile-style bottom navigation (spec §5.6): the primary destinations as
/// icon-first buttons with a clear active state, plus an overflow holding the
/// less-used Appearance panel and the exit-mini-mode control, so the user is
/// never trapped even without the menu bar.
struct MiniTabBar: View {
    @Binding var active: MiniTab
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }
    private let primary: [MiniTab] = [.chat, .sessions, .files, .viewer]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(primary) { tab in
                tabButton(tab)
            }
            overflow
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color(theme.chrome))
        .overlay(alignment: .top) { Rectangle().fill(Color(theme.border)).frame(height: 1) }
    }

    private func tabButton(_ tab: MiniTab) -> some View {
        let on = active == tab
        return Button {
            withAnimation(.easeOut(duration: 0.22)) { active = tab }
        } label: {
            label(icon: tab.icon, text: tab.label, on: on)
        }
        .buttonStyle(.iconHover)
        .help(tab.label)
    }

    private var overflow: some View {
        let on = active == .appearance
        return Menu {
            Button {
                withAnimation(.easeOut(duration: 0.22)) { active = .appearance }
            } label: {
                Label("Appearance", systemImage: "paintpalette")
            }
            Divider()
            Button {
                MiniModeManager.shared.toggle()
            } label: {
                Label("Exit Mini Mode", systemImage: "arrow.up.left.and.arrow.down.right")
            }
        } label: {
            label(icon: "ellipsis", text: "More", on: on)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .frame(maxWidth: .infinity)
    }

    private func label(icon: String, text: String, on: Bool) -> some View {
        VStack(spacing: 2) {
            Image(systemName: icon).font(.system(size: 15))
            Text(text).font(.system(size: 9, weight: .medium))
        }
        .foregroundStyle(on ? settings.actionStyle.color : Color(theme.secondaryForeground))
        .frame(maxWidth: .infinity)
        .frame(height: 40)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(on ? settings.actionStyle.softFill : AnyShapeStyle(Color.clear))
        )
        .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
