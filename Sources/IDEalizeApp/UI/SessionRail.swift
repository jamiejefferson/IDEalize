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
    @State private var showingArchive = false

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
        .sheet(isPresented: $showingArchive) {
            ArchivedChatsSheet(workspace: workspace)
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Projects")
                .font(settings.ui(12, .semibold))
                .foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            if !settings.archivedChats.isEmpty {
                Button(action: { showingArchive = true }) {
                    HStack(spacing: 4) {
                        Image(systemName: "archivebox")
                            .font(.system(size: 11, weight: .semibold))
                        Text("\(settings.archivedChats.count)")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(height: 26).padding(.horizontal, 8)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
                }
                .buttonStyle(.raisedIconHover)
                .help("View archived chats")
            }
            Button(action: { workspace.newTabPickingFolder() }) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
            }
            .buttonStyle(.raisedIconHover)
            .help("Open a new project folder (⌘T)")
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
            .buttonStyle(.iconHover(padding: 3))
            .help(collapsed ? "Show this project's chats" : "Collapse this project")

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
            .buttonStyle(.iconHover(padding: 3))
            .help("Shared note — every chat in this project can see it")

            Button(action: { workspace.newTab(projectPath: group.path) }) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.iconHover(padding: 3))
            .help("New chat in \(group.displayName)")
        }
        .padding(.horizontal, 4).padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture { workspace.toggleCollapsed(group.path) }
    }

    private var noteEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Shared Notes: a brief the human writes; every chat can read it. The
            // native vertical TextField gives a placeholder that always sits
            // exactly where typed text does (no manual alignment).
            VStack(alignment: .leading, spacing: 4) {
                sectionTitle("Shared Notes")
                TextField("Jot anything every chat should know",
                          text: $noteText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .font(style.font(11))
                    .foregroundStyle(style.textColor)
                    .padding(.horizontal, 7).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(theme.background).opacity(0.5)))
                    .onChange(of: noteText) { _, new in
                        // Debounce the disk write (and resulting rail re-render)
                        // so typing isn't a synchronous file write per keystroke.
                        noteSaveWork?.cancel()
                        let work = DispatchWorkItem { workspace.setProjectNote(group.path, new) }
                        noteSaveWork = work
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
                    }
            }

            // Agent Notes: what each chat is doing — auto-derived from Claude's
            // activity, or a chat's own `idealize note --mine`. Sits in the same
            // boxed "field" as Shared Notes so the two sections read consistently.
            if !group.tabs.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    sectionTitle("Agent Notes")
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(Array(group.tabs.enumerated()), id: \.element.id) { index, tab in
                            if let session = tab.sessions.first {
                                ChatStatusRow(label: chatLabel(tab, index), session: session)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 7).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color(theme.background).opacity(0.5)))
                }
            }
        }
        .padding(.horizontal, 2).padding(.top, 2).padding(.bottom, 4)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 9, weight: .semibold))
            .tracking(0.4)
            .foregroundStyle(style.secondaryTextColor.opacity(0.7))
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
            if let primary { ContextMeter(session: primary) }
            trailing
            if hovering || isSelected {
                Button(action: { workspace.archiveTab(tab) }) {
                    Image(systemName: "archivebox")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                .buttonStyle(.iconHover(padding: 2, radius: 4))
                .help("Archive this chat — closes it but keeps it to reopen later")
                Button(action: { workspace.closeTab(tab) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                .buttonStyle(.iconHover(padding: 2, radius: 4)).help("Close this chat")
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
        // Double-click the chat to rename it in place; a single click selects.
        .onTapGesture(count: 2) { onRename() }
        .onTapGesture {
            workspace.selectedTabID = tab.id
            if let s = tab.sessions.first { workspace.focusSession(s.id) }
        }
        .contextMenu {
            Button("Rename…", action: onRename)
            Button("Archive Chat") { workspace.archiveTab(tab) }
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

    /// A small leading marker: the agent's glyph when an agent session is
    /// running here, otherwise a plain running/activity dot.
    @ViewBuilder private var leadingIcon: some View {
        if let primary {
            if primary.isAgentRunning {
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

// MARK: - Context meter

/// A compact gauge of how full a chat's Claude context is — a tinted bar that
/// greens→ambers→reds as the conversation fills, so you can see at a glance when
/// to archive it and start a fresh chat. Renders nothing for a non-Claude chat or
/// before Claude has reported any usage.
private struct ContextMeter: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        if let fraction = session.contextFraction, let tokens = session.contextTokens {
            Capsule()
                .fill(Color(theme.border))
                .frame(width: 26, height: 4)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(color(fraction))
                        .frame(width: max(3, 26 * fraction), height: 4)
                }
                .help("Context ~\(Int(fraction * 100))% full (\(shortTokens(tokens)) tokens)"
                      + (fraction >= 0.8 ? " — consider archiving and starting a fresh chat" : ""))
        }
    }

    /// Neutral accent while there's room, amber past ⅗, red near full.
    private func color(_ f: Double) -> Color {
        if f >= 0.85 { return Color(red: 0.90, green: 0.30, blue: 0.24) }
        if f >= 0.60 { return Color(red: 0.95, green: 0.61, blue: 0.14) }
        return settings.actionStyle.color
    }
}

/// "124k" / "980" — compact token counts for the rail's tight space.
private func shortTokens(_ n: Int) -> String {
    n >= 1000 ? String(format: "%.0fk", Double(n) / 1000) : "\(n)"
}

// MARK: - Archived chats

/// A list of every archived chat, grouped by project, each reopenable (resuming
/// its Claude conversation where possible) or deletable. Reached from the
/// Projects header's archive button.
private struct ArchivedChatsSheet: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @Environment(\.dismiss) private var dismiss
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Archived Chats")
                    .font(settings.ui(15, .semibold))
                    .foregroundStyle(Color(theme.foreground))
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 12)
            Rectangle().fill(Color(theme.border)).frame(height: 1)

            if settings.archivedChats.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(workspace.archivedByProject, id: \.path) { group in
                            projectSection(group)
                        }
                    }
                    .padding(20)
                }
            }
        }
        .frame(width: 480, height: 540)
        .background(Color(theme.chrome))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "archivebox")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.6))
            Text("No archived chats yet")
                .font(settings.ui(13, .medium))
                .foregroundStyle(Color(theme.secondaryForeground))
            Text("Archive a chat from the rail to tuck it away here — you can reopen it any time.")
                .font(settings.ui(11))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.7))
                .multilineTextAlignment(.center).frame(width: 300)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func projectSection(_ group: (path: String, name: String, chats: [ArchivedChat])) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(theme.secondaryForeground))
                Text(group.name)
                    .font(settings.ui(11, .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            ForEach(group.chats) { chat in row(chat) }
        }
    }

    private func row(_ chat: ArchivedChat) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(chat.name)
                    .font(settings.ui(13, .medium))
                    .foregroundStyle(Color(theme.foreground))
                Text(subtitle(chat))
                    .font(settings.ui(10.5))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            Spacer(minLength: 8)
            Button(action: { workspace.reopenArchived(chat); dismiss() }) {
                Text("Reopen").font(settings.ui(11, .semibold))
                    .foregroundStyle(settings.actionStyle.color)
            }
            .buttonStyle(.plain)
            .help(chat.wasClaude ? "Reopen and resume this Claude conversation"
                                 : "Reopen this chat")
            Button(action: { workspace.deleteArchived(chat) }) {
                Image(systemName: "trash")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.iconHover(padding: 3))
            .help("Delete this archived chat permanently")
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(theme.surface)))
    }

    private func subtitle(_ chat: ArchivedChat) -> String {
        var parts: [String] = []
        if let t = chat.contextTokens, t > 0 {
            let limit = chat.contextLimit ?? ClaudeTranscript.defaultContextWindowLimit
            let pct = Int(min(1, Double(t) / Double(limit)) * 100)
            parts.append("\(shortTokens(t)) tokens · \(pct)% context")
        } else if chat.wasClaude {
            parts.append("Claude chat")
        }
        parts.append("archived \(chat.archivedAt.formatted(date: .abbreviated, time: .shortened))")
        return parts.joined(separator: "  ·  ")
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
