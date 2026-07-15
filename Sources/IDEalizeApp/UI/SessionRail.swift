import SwiftUI

/// The left-hand vertical session rail, grouped like Conductor: **Projects**
/// (folders) that contain **Chats** (terminals). Each project is a card; its
/// chats nest inside. Unread chats show in **bold**. A project header carries a
/// Shared Project Note every chat in the project can see.
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
                LazyVStack(spacing: 8) {
                    ForEach(workspace.projectGroups) { group in
                        ProjectCard(group: group, workspace: workspace) { tab in
                            renameText = tab.customName ?? ""
                            renaming = tab
                        }
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
            Text("Projects")
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
            .help("Open a new project folder (⌘T)")
        }
        .padding(.horizontal, 12).frame(height: 34)
    }

    private func renameSheet(_ tab: WorkspaceTab) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Rename Chat").font(settings.ui(15, .semibold))
            TextField("Chat name", text: $renameText)
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
        workspace.renameTab(tab, to: renameText)
        renaming = nil
    }
}

// MARK: - Project card (a folder that contains chats)

private struct ProjectCard: View {
    let group: Workspace.ProjectGroup
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    let onRenameTab: (WorkspaceTab) -> Void

    @State private var noteExpanded = false
    @State private var noteText = ""
    @State private var noteSaveWork: DispatchWorkItem?

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.sessions, base: 13, background: theme.chrome) }

    private var collapsed: Bool { workspace.isCollapsed(group.path) }
    private var hasUnread: Bool { group.tabs.contains { $0.hasUnread } }
    private var hasNote: Bool { workspace.projectHasNote(group.path) }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            header
            if noteExpanded { noteEditor }
            if !collapsed {
                ForEach(Array(group.tabs.enumerated()), id: \.element.id) { index, tab in
                    SessionCard(tab: tab, workspace: workspace,
                                label: chatLabel(tab, index),
                                onRename: { onRenameTab(tab) })
                        .onDrag {
                            workspace.draggingTabID = tab.id
                            return NSItemProvider(object: tab.id.uuidString as NSString)
                        }
                        .onDrop(of: [.text],
                                delegate: TabDropDelegate(target: tab, workspace: workspace))
                }
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 11)
                .fill(Color(theme.surface))
                .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(Color(theme.border), lineWidth: 1))
        )
    }

    /// A chat's label inside its project card — delegates to the workspace so the
    /// rail and the agent-facing `idealize note` always agree on chat names.
    private func chatLabel(_ tab: WorkspaceTab, _ index: Int) -> String {
        workspace.chatLabel(tab, index: index)
    }

    private var header: some View {
        HStack(spacing: 7) {
            Button(action: { workspace.toggleCollapsed(group.path) }) {
                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 12)
            }
            .buttonStyle(.plain)

            Image(systemName: "folder.fill")
                .font(.system(size: 11))
                .foregroundStyle(Color(theme.secondaryForeground))

            Text(group.displayName)
                .font(style.font(12, hasUnread ? .bold : .semibold))
                .foregroundStyle(style.textColor)
                .panelText(style)
                .lineLimit(1)

            if collapsed && hasUnread {
                Circle().fill(settings.actionStyle.color).frame(width: 6, height: 6)
            }

            Spacer(minLength: 4)

            Text("\(group.tabs.count)")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.7))

            Button(action: { toggleNote() }) {
                Image(systemName: hasNote ? "note.text" : "note")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(hasNote ? settings.actionStyle.color : Color(theme.secondaryForeground))
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .help("Shared note — every chat in this project can see it")

            Button(action: { workspace.newTab(projectPath: group.path) }) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .help("New chat in \(group.displayName)")
        }
        .padding(.horizontal, 4).padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture { workspace.toggleCollapsed(group.path) }
    }

    private var noteEditor: some View {
        VStack(alignment: .leading, spacing: 7) {
            ZStack(alignment: .topLeading) {
                if noteText.isEmpty {
                    Text("What are all the chats in this project working on?")
                        .font(style.font(11))
                        .foregroundStyle(style.secondaryTextColor.opacity(0.7))
                        .padding(.horizontal, 5).padding(.vertical, 6)
                }
                TextEditor(text: $noteText)
                    .font(style.font(11))
                    .foregroundStyle(style.textColor)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 40, maxHeight: 110)
                    .onChange(of: noteText) { _, new in
                        // Debounce the disk write (and the resulting rail
                        // re-render) so typing isn't a synchronous file write +
                        // full re-render per keystroke.
                        noteSaveWork?.cancel()
                        let work = DispatchWorkItem { workspace.setProjectNote(group.path, new) }
                        noteSaveWork = work
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
                    }
            }

            // Live shared understanding: what each chat in the project is doing.
            // Auto-derived from Claude's activity, or the chat's own `idealize
            // note --mine`. Read-only here.
            if !group.tabs.isEmpty {
                Rectangle().fill(Color(theme.border)).frame(height: 1)
                VStack(alignment: .leading, spacing: 4) {
                    Text("WHAT EACH CHAT IS WORKING ON")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(style.secondaryTextColor.opacity(0.7))
                    ForEach(Array(group.tabs.enumerated()), id: \.element.id) { index, tab in
                        if let session = tab.sessions.first {
                            ChatStatusRow(label: chatLabel(tab, index), session: session)
                        }
                    }
                }
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(theme.background).opacity(0.5)))
        .padding(.horizontal, 2).padding(.bottom, 2)
    }

    private func toggleNote() {
        if !noteExpanded { noteText = workspace.projectNote(group.path) }
        withAnimation(.easeOut(duration: 0.12)) { noteExpanded.toggle() }
    }
}

/// One line in a project's shared-status view: a status dot, the chat's name,
/// and what it's working on. Observes the session so it updates live.
private struct ChatStatusRow: View {
    let label: String
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.sessions, base: 13, background: theme.chrome) }

    private var dotColor: Color {
        switch session.agentStatus {
        case .working:  return Color(red: 0.23, green: 0.51, blue: 0.96)
        case .waiting:  return settings.actionStyle.color
        case .complete: return settings.actionStyle.color
        case .idle:     return session.agentNote != nil ? settings.actionStyle.color
                                                        : Color(theme.secondaryForeground).opacity(0.6)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Circle().fill(dotColor).frame(width: 6, height: 6).padding(.top, 3)
            (Text(label + "  ").font(style.font(10.5, .semibold)).foregroundStyle(style.textColor)
             + Text(session.activityLine).font(style.font(10.5)).foregroundStyle(style.secondaryTextColor))
                .panelText(style)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Chat row (one terminal)

private struct SessionCard: View {
    @ObservedObject var tab: WorkspaceTab
    @ObservedObject var workspace: Workspace
    let label: String
    let onRename: () -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false

    private var theme: Theme { settings.theme }
    private var style: PanelStyle { settings.panelStyle(.sessions, base: 13, background: theme.chrome) }
    private var isSelected: Bool { workspace.selectedTabID == tab.id }
    private var primary: TerminalSession? { tab.sessions.first }
    private var isUnread: Bool { tab.hasUnread }

    var body: some View {
        HStack(spacing: 9) {
            leadingIcon
            Text(label)
                .font(style.font(13, nameWeight))
                .foregroundStyle(style.textColor)
                .panelText(style)
                .lineLimit(1)
            Spacer(minLength: 4)
            trailing
            if hovering || isSelected {
                Button(action: { workspace.closeTab(tab) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 7)
                .fill(Color(hovering ? theme.surfaceHover : .clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7)
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
            Button("Close Chat") { workspace.closeTab(tab) }
        }
    }

    /// Bold when the chat has something new for you; semibold when selected; else
    /// regular. Bold is the primary "unread" signal.
    private var nameWeight: Font.Weight {
        if isUnread { return .bold }
        return isSelected ? .semibold : .regular
    }

    /// The live agent tag (Working/Waiting/Complete) when active; otherwise a
    /// small unread dot for background activity / unread messages.
    @ViewBuilder private var trailing: some View {
        if let primary, primary.agentStatus != .idle {
            AgentStatusBadge(session: primary)
        } else if isUnread {
            Circle().fill(settings.actionStyle.color).frame(width: 6, height: 6)
        }
    }

    /// A small leading marker: Claude's glyph when a Claude session is running
    /// here, otherwise a plain running/activity dot.
    @ViewBuilder private var leadingIcon: some View {
        if let primary {
            if primary.isClaudeRunning {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    .foregroundStyle(settings.actionStyle.color)
            } else {
                SessionStatusDot(session: primary)
            }
        } else {
            Circle().fill(Color(theme.secondaryForeground)).frame(width: 8, height: 8)
        }
    }
}

/// Reorders chats when one is dropped onto another **within the same project**
/// (a chat's folder defines its project, so cross-project drag is meaningless).
private struct TabDropDelegate: DropDelegate {
    let target: WorkspaceTab
    let workspace: Workspace

    func dropEntered(info: DropInfo) {
        guard let dragId = workspace.draggingTabID, dragId != target.id,
              let from = workspace.tabs.firstIndex(where: { $0.id == dragId }),
              let to = workspace.tabs.firstIndex(where: { $0.id == target.id }) else { return }
        // Only reorder inside one project.
        guard workspace.projectKey(for: workspace.tabs[from]) == workspace.projectKey(for: target) else { return }
        if workspace.tabs[to].id != dragId {
            withAnimation(.easeInOut(duration: 0.18)) {
                let moved = workspace.tabs.remove(at: from)
                workspace.tabs.insert(moved, at: to)
            }
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        workspace.draggingTabID = nil
        workspace.scheduleSnapshotSave()
        return true
    }
}
