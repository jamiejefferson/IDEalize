import SwiftUI

/// The horizontal tab strip. Each tab shows a status dot, name, the foreground
/// process, and an unread badge.
struct TabBarView: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 0) {
            // Leave room for the macOS traffic-light controls.
            Spacer().frame(width: 72)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(workspace.tabs) { tab in
                        TabChip(tab: tab, workspace: workspace)
                    }
                }
                .padding(.vertical, 6)
            }
            Button(action: { workspace.newTab() }) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 26, height: 26)
                    .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.surface)))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 10)
            .help("New terminal tab (⌘T)")
        }
        .frame(height: 40)
        .background(Color(theme.chrome))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(theme.border)).frame(height: 1)
        }
    }
}

private struct TabChip: View {
    @ObservedObject var tab: WorkspaceTab
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false

    private var theme: Theme { settings.theme }
    private var isSelected: Bool { workspace.selectedTabID == tab.id }
    private var primary: TerminalSession? { tab.sessions.first }

    var body: some View {
        HStack(spacing: 6) {
            if let primary {
                AgentStatusBadge(session: primary, compact: true)
            }
            Text(tab.name)
                .font(settings.ui(12, isSelected ? .semibold : .regular))
                .foregroundStyle(Color(isSelected ? theme.foreground : theme.secondaryForeground))
                .lineLimit(1)
            if let primary, !primary.isShellForeground {
                Text(primary.processName)
                    .font(settings.ui(10))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            if tab.sessions.count > 1 {
                Image(systemName: "rectangle.split.2x1")
                    .font(.system(size: 9))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            let unread = tab.sessions.reduce(0) { $0 + $1.unreadCount }
            if unread > 0 {
                Text("\(unread)")
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(Color.red))
                    .foregroundStyle(.white)
            }
            if isSelected || hovering {
                Button(action: { workspace.closeTab(tab) }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 11)
        .frame(height: 28)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(isSelected ? theme.surfaceHover : (hovering ? theme.surface : theme.chrome)))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(Color(isSelected ? theme.accent.withAlphaComponent(0.55) : theme.border),
                              lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture {
            workspace.selectedTabID = tab.id
            if let s = tab.sessions.first { workspace.focusSession(s.id) }
        }
    }
}

