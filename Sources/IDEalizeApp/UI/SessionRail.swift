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
            if let primary, primary.agentStatus != .idle {
                AgentStatusBadge(session: primary)
            } else {
                let unread = tab.sessions.reduce(0) { $0 + $1.unreadCount }
                if unread > 0 {
                    Text("\(unread)")
                        .font(.system(size: 9, weight: .bold))
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Capsule().fill(Color.red))
                        .foregroundStyle(.white)
                }
            }
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

    /// A small leading marker for the card: Claude's glyph when a Claude session
    /// is running here, otherwise a plain running/activity dot. The live
    /// Working/Waiting/Complete tag is carried by the trailing `AgentStatusBadge`.
    @ViewBuilder private var leadingIcon: some View {
        if let primary {
            if primary.isClaudeRunning {
                Image(systemName: "sparkles").font(.system(size: 13)).foregroundStyle(Color(theme.accent))
            } else {
                SessionStatusDot(session: primary)
            }
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
