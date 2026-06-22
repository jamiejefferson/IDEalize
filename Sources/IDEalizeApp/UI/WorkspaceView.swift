import SwiftUI

/// The main window content: tab strip on top, the selected tab's split tree below.
struct WorkspaceView: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            // A plain HStack with hairline dividers — HSplitView's native divider
            // renders as a hard black line, which reads as "heavy".
            HStack(spacing: 0) {
                if workspace.showSessionRail {
                    SessionRail(workspace: workspace).frame(width: settings.railWidth)
                    ResizeHandle(width: $settings.railWidth, range: 150...320)
                }
                if workspace.showFileExplorer {
                    FileExplorerPanel(workspace: workspace).frame(width: settings.filesWidth)
                    ResizeHandle(width: $settings.filesWidth, range: 150...380)
                }
                if workspace.showViewer {
                    FileViewerPanel(workspace: workspace).frame(width: settings.viewerWidth)
                    ResizeHandle(width: $settings.viewerWidth, range: 260...800)
                }
                VStack(spacing: 0) {
                    Group {
                        if let tab = workspace.selectedTab {
                            PaneView(node: tab.root, workspace: workspace)
                                .id(tab.id)
                        } else {
                            EmptyState(workspace: workspace)
                        }
                    }
                    BottomToolbar(workspace: workspace)
                }
                .frame(minWidth: 420, maxWidth: .infinity)
            }
        }
        .frame(minWidth: 900, minHeight: 460)
        .background(Color(settings.theme.background))
        .background(WindowConfigurator(background: settings.theme.chrome, isDark: settings.theme.isDark))
        .overlay(alignment: .trailing) {
            if workspace.showAppearance {
                AppearancePanel(workspace: workspace)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.18), value: workspace.showAppearance)
        .overlay(alignment: .top) {
            if workspace.showCommandPalette {
                ZStack(alignment: .top) {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { workspace.showCommandPalette = false }
                    CommandPalette(workspace: workspace,
                                   settings: settings,
                                   workflowStore: WorkflowStore.shared)
                        .padding(.top, 70)
                }
            }
        }
        .sheet(item: $workspace.pendingWorkflow) { wf in
            WorkflowSheet(workflow: wf, workspace: workspace)
        }
        .onChange(of: settings.themeName) { workspace.reapplyAppearance() }
        .onChange(of: settings.fontName) { workspace.reapplyAppearance() }
        .onChange(of: settings.fontSize) { workspace.reapplyAppearance() }
        .onChange(of: settings.panelAppearances) { workspace.reapplyAppearance() }
    }

    /// A unified chrome strip across the top, behind the traffic lights. Dragging
    /// it moves the window (only here — not the whole content background).
    private var titleBar: some View {
        Color(settings.theme.chrome)
            .frame(height: 28)
            .frame(maxWidth: .infinity)
            .overlay(WindowDragBar())
    }
}

/// A transparent AppKit view that lets a click-drag move the window. Scoped to
/// the title bar so it never hijacks gestures elsewhere (e.g. the chat resize).
private struct WindowDragBar: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class DragView: NSView {
        override var mouseDownCanMoveWindow: Bool { true }
    }
}

/// A thin toolbar pinned to the very bottom: panel toggles on the left and the
/// focused terminal's working directory on the right (echoing the reference's
/// bottom bar).
private struct BottomToolbar: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    private var cwd: String {
        guard let p = workspace.focusedSession?.projectPath, !p.isEmpty else { return "~" }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if p == home { return "~" }
        if p.hasPrefix(home) { return "~" + p.dropFirst(home.count) }
        return p
    }

    var body: some View {
        HStack(spacing: 4) {
            toggle("sidebar.left", on: workspace.showSessionRail, help: "Toggle sessions") {
                workspace.showSessionRail.toggle()
            }
            toggle("folder", on: workspace.showFileExplorer, help: "Toggle file explorer") {
                workspace.showFileExplorer.toggle()
            }
            toggle("doc.text", on: workspace.showViewer, help: "Toggle document panel") {
                workspace.showViewer.toggle()
            }
            iconButton("command", help: "Command palette (⌘P)") {
                workspace.showCommandPalette.toggle()
            }
            iconButton("rectangle.split.2x1", help: "Split right (⌘D)") {
                workspace.splitFocused(axis: .horizontal)
            }
            toggle("paintpalette", on: workspace.showAppearance, help: "Appearance (⌘⌥A)") {
                workspace.showAppearance.toggle()
            }
            .keyboardShortcut("a", modifiers: [.command, .option])
            Spacer()
            HStack(spacing: 5) {
                Image(systemName: "folder.fill").font(.system(size: 9))
                Text(cwd).font(settings.ui(11, .medium)).lineLimit(1).truncationMode(.head)
            }
            .foregroundStyle(Color(theme.secondaryForeground))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Capsule().fill(Color(theme.surface)))
            FeedbackButton()
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color(theme.chrome))
        .overlay(alignment: .top) { Rectangle().fill(Color(theme.border)).frame(height: 1) }
    }

    private func toggle(_ icon: String, on: Bool, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(on ? settings.actionStyle.color : Color(theme.secondaryForeground))
                .frame(width: 28, height: 24)
                .background(RoundedRectangle(cornerRadius: 6)
                    .fill(on ? settings.actionStyle.softFill : AnyShapeStyle(Color.clear)))
        }
        .buttonStyle(.plain)
        .help(help)
    }

    private func iconButton(_ icon: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 28, height: 24)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// The bottom command bar. Only shown when the focused shell is idle at its
/// prompt — when a foreground program is running it owns the screen instead.
/// Observes the focused session so it appears/disappears reactively.
private struct ComposerBar: View {
    @ObservedObject var workspace: Workspace

    var body: some View {
        if let session = workspace.focusedSession {
            ComposerBarInner(session: session, workspace: workspace)
        }
    }
}

private struct ComposerBarInner: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var workspace: Workspace

    private var hasBlocks: Bool { !session.blocks.isEmpty }
    private var isRunningCommand: Bool { session.blocks.last?.isRunning == true }

    var body: some View {
        // Plain shell command bar — at an idle prompt with history. Hidden in
        // Claude/TUI mode (the floating chat box carries its own input) and
        // while a normal command scrolls or on a bare fresh shell.
        if !session.tuiActive, hasBlocks, !isRunningCommand {
            CommandComposer(workspace: workspace)
        }
    }
}

/// A subtle hairline divider that doubles as a drag handle to resize the panel
/// on its left. Keeps the clean look while restoring resizing.
private struct ResizeHandle: View {
    @Binding var width: Double
    let range: ClosedRange<Double>
    @ObservedObject private var settings = AppSettings.shared
    @State private var startWidth: Double?
    @State private var hovering = false

    var body: some View {
        Rectangle()
            .fill(Color(settings.theme.border))
            .frame(width: 1)
            .overlay(
                Color.clear
                    .frame(width: 11)
                    .contentShape(Rectangle())
                    .onHover { h in
                        hovering = h
                        if h { NSCursor.resizeLeftRight.set() } else { NSCursor.arrow.set() }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 1)
                            .onChanged { v in
                                let s = startWidth ?? width
                                if startWidth == nil { startWidth = s }
                                width = min(range.upperBound, max(range.lowerBound, s + v.translation.width))
                            }
                            .onEnded { _ in startWidth = nil }
                    )
            )
    }
}

/// Cleans up the hidden-titlebar window: removes the title-bar separator line
/// and material seam, tints the title-bar area to match the chrome, and lets the
/// whole top strip drag the window.
private struct WindowConfigurator: NSViewRepresentable {
    let background: NSColor
    let isDark: Bool

    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { configure(v.window) }
        return v
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { configure(nsView.window) }
    }

    private func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        // Dragging is handled by the title-bar strip only (WindowDragBar), so the
        // chat resize/move gestures aren't hijacked.
        window.isMovableByWindowBackground = false
        window.backgroundColor = background
        // Match system controls (pickers, sliders, toggles) to the theme.
        window.appearance = NSAppearance(named: isDark ? .darkAqua : .aqua)
    }
}

private struct EmptyState: View {
    @ObservedObject var workspace: Workspace

    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    private var recents: [String] { Array(settings.recentFolders.prefix(3)) }

    var body: some View {
        VStack(spacing: 20) {
            if let logo = Branding.logo {
                Image(nsImage: logo).resizable().scaledToFit().frame(width: 150)
                    .opacity(0.92)
            } else {
                Image(systemName: "terminal").font(.system(size: 48)).foregroundStyle(.secondary)
            }
            if recents.isEmpty {
                Text("No recent sessions").font(settings.ui(14)).foregroundStyle(Color(theme.secondaryForeground))
            } else {
                VStack(spacing: 6) {
                    Text("RECENT SESSIONS").font(settings.ui(10, .semibold)).tracking(1)
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .padding(.bottom, 2)
                    ForEach(recents, id: \.self) { path in
                        Button(action: { workspace.newTab(projectPath: path) }) {
                            HStack(spacing: 9) {
                                Image(systemName: "folder.fill").font(.system(size: 12))
                                    .foregroundStyle(Color(theme.accent))
                                Text((path as NSString).lastPathComponent)
                                    .font(settings.ui(14, .medium)).foregroundStyle(Color(theme.foreground))
                                Spacer()
                                Text(abbreviate(path)).font(settings.ui(11))
                                    .foregroundStyle(Color(theme.secondaryForeground)).lineLimit(1).truncationMode(.head)
                            }
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(RoundedRectangle(cornerRadius: 9).fill(Color(theme.surface)))
                            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Color(theme.border), lineWidth: 1))
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                .frame(width: 360)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(settings.panelStyle(.terminal, base: 13, background: theme.background).background)
    }

    private func abbreviate(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home { return "~" }
        if path.hasPrefix(home) { return "~" + path.dropFirst(home.count) }
        return path
    }
}
