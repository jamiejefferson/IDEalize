import SwiftUI

/// The left-hand vertical session rail: a stacked list of open terminals (one
/// card per tab). Drag to reorder, right-click to rename.
struct SessionRail: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @State private var renaming: WorkspaceTab?
    @State private var renameText = ""

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.sessions, base: 13, background: theme.chrome) }

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            if workspace.suggestedProjectAgentPath != nil {
                projectAgentSuggestion
            }
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(workspace.tabs) { tab in
                        SessionCard(tab: tab, workspace: workspace) {
                            renameText = tab.displayName
                            renaming = tab
                        }
                        .onDrag {
                            workspace.draggingTabID = tab.id
                            return NSItemProvider(object: tab.id.uuidString as NSString)
                        }
                        .onDrop(of: [.text], delegate: TabDropDelegate(target: tab, workspace: workspace))
                    }
                }
                .padding(8)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(style.background)
        .sheet(item: $renaming) { tab in
            renameSheet(tab)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Sessions")
                .font(settings.ui(12, .semibold))
                .foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            Button(action: { workspace.newTabPickingFolder() }) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
            }
            .buttonStyle(.plain)
            .help("New terminal tab in a folder (⌘T)")
        }
        .padding(.horizontal, 12).frame(height: 34)
    }

    /// A gentle nudge, shown when several chats share the focused project with
    /// no project agent coordinating them yet. Dismissed per project for the
    /// run of the app.
    private var projectAgentSuggestion: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 12))
                .foregroundStyle(settings.actionStyle.color)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 5) {
                Text("Several chats are working in this project. A project agent can keep them in sync.")
                    .font(style.font(11, .medium))
                    .foregroundStyle(style.textColor)
                    .panelText(style)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Start project agent") { workspace.openProjectAgent() }
                    .font(style.font(10, .semibold))
                    .foregroundStyle(settings.actionStyle.color)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(settings.actionStyle.softFill))
                    .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            Button(action: dismissProjectAgentSuggestion) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain)
            .help("Not now")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color(theme.surface)))
        .padding(.horizontal, 8).padding(.top, 8)
    }

    private func dismissProjectAgentSuggestion() {
        guard let p = workspace.suggestedProjectAgentPath else { return }
        workspace.dismissedProjectAgentSuggestions.insert(p)
    }

    private func renameSheet(_ tab: WorkspaceTab) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Rename Tab").font(settings.ui(15, .semibold))
            TextField("Tab name", text: $renameText)
                .textFieldStyle(.roundedBorder)
                .frame(width: 280)
                .onSubmit { commitRename(tab) }
            HStack {
                Spacer()
                Button("Cancel") { renaming = nil }
                Button("Rename") { commitRename(tab) }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }

    private func commitRename(_ tab: WorkspaceTab) {
        let t = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        tab.customName = t.isEmpty ? nil : t
        tab.objectWillChange.send()
        workspace.objectWillChange.send()
        renaming = nil
    }
}

private struct SessionCard: View {
    @ObservedObject var tab: WorkspaceTab
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    let onRename: () -> Void
    @State private var hovering = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.sessions, base: 13, background: theme.chrome) }
    private var isSelected: Bool { workspace.selectedTabID == tab.id }
    private var primary: TerminalSession? { tab.sessions.first }


    private var subtitle: String {
        if let p = primary?.projectPath, !p.isEmpty, p != "/" { return abbreviate(p) }
        return "~"
    }

    var body: some View {
        HStack(spacing: 9) {
            leadingIcon
            VStack(alignment: .leading, spacing: 1) {
                Text(tab.displayName)
                    .font(style.font(13, isSelected ? .semibold : .medium))
                    .foregroundStyle(style.textColor)
                    .panelText(style)
                    .lineLimit(1)
                Text(subtitle)
                    .font(style.font(10))
                    .foregroundStyle(style.secondaryTextColor)
                    .panelText(style)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 4)
            SessionCardStatus(sessions: tab.sessions)
            if hovering || isSelected {
                Button(action: { workspace.closeTab(tab) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 9)
                .fill(Color(hovering ? theme.surface : .clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9)
                .strokeBorder(isSelected ? settings.actionStyle.color : .clear,
                              lineWidth: isSelected ? 1.5 : 1)
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture {
            workspace.selectedTabID = tab.id
            if let s = tab.sessions.first { workspace.focusSession(s.id) }
        }
        .contextMenu {
            Button("Rename…", action: onRename)
            Button("Close Tab") { workspace.closeTab(tab) }
        }
    }

    /// A small leading marker for the card: the agent's glyph when an agent
    /// session is running here, otherwise a plain running/activity dot. The live
    /// Working/Waiting/Complete tag is carried by the trailing `AgentStatusBadge`.
    @ViewBuilder private var leadingIcon: some View {
        if let primary {
            SessionCardLeading(session: primary)
        } else {
            Circle().fill(Color(theme.secondaryForeground)).frame(width: 8, height: 8)
        }
    }

    private func abbreviate(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home { return "~" }
        if path.hasPrefix(home) { return "~" + path.dropFirst(home.count) }
        return path
    }
}

/// Re-evaluates `content` whenever `session` publishes. TerminalSession changes
/// (agentStatus, unreadCount, isAgentRunning) fire the session's own
/// objectWillChange — not the tab's or workspace's — so rail-card bits driven by
/// session state are wrapped in one of these to actually re-render.
private struct SessionObserver<Content: View>: View {
    @ObservedObject var session: TerminalSession
    @ViewBuilder var content: () -> Content

    var body: some View { content() }
}

/// The leading session marker, observed: the agent's glyph when an agent is
/// running on this session, otherwise the plain running/activity dot.
private struct SessionCardLeading: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        if session.isAgentRunning {
            Image(systemName: "sparkles").font(.system(size: 13)).foregroundStyle(Color(theme.accent))
        } else {
            SessionStatusDot(session: session)
        }
    }
}

/// The trailing status cluster: the agent badge while the primary session has
/// agent activity, else the unread pill. Extracted from the card so the
/// deciding property (`agentStatus`, published by the session) is observed.
private struct SessionCardStatus: View {
    let sessions: [TerminalSession]

    var body: some View {
        if let primary = sessions.first {
            SessionObserver(session: primary) {
                if primary.agentStatus != .idle {
                    AgentStatusBadge(session: primary)
                } else {
                    SessionUnreadPill(sessions: sessions)
                }
            }
        }
    }
}

/// The tab's combined unread count. Any session in a split can accrue unread
/// while unfocused, so every session is observed (one `SessionObserver` each);
/// when any publishes, the sum is re-read and the pill re-renders.
private struct SessionUnreadPill: View {
    let sessions: [TerminalSession]

    private var unread: Int { sessions.reduce(0) { $0 + $1.unreadCount } }

    var body: some View {
        ObserveSessions(sessions: sessions[...]) {
            if unread > 0 {
                Text("\(unread)")
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(Color.red))
                    .foregroundStyle(.white)
            }
        }
    }
}

/// Observes every session in the slice, re-evaluating `content` when any of
/// them publishes. Recursive so a tab with several split sessions is covered.
private struct ObserveSessions<Content: View>: View {
    let sessions: ArraySlice<TerminalSession>
    @ViewBuilder var content: () -> Content

    var body: some View {
        if let first = sessions.first {
            SessionObserver(session: first) {
                ObserveSessions(sessions: sessions.dropFirst(), content: content)
            }
        } else {
            content()
        }
    }
}

/// Reorders tabs when one card is dropped onto another.
private struct TabDropDelegate: DropDelegate {
    let target: WorkspaceTab
    let workspace: Workspace

    func dropEntered(info: DropInfo) {
        guard let dragId = workspace.draggingTabID, dragId != target.id,
              let from = workspace.tabs.firstIndex(where: { $0.id == dragId }),
              let to = workspace.tabs.firstIndex(where: { $0.id == target.id }) else { return }
        if workspace.tabs[to].id != dragId {
            withAnimation(.easeInOut(duration: 0.18)) {
                let moved = workspace.tabs.remove(at: from)
                workspace.tabs.insert(moved, at: to)
            }
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        workspace.draggingTabID = nil
        return true
    }
}
