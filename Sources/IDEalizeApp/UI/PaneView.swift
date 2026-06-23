import SwiftUI
import UniformTypeIdentifiers

/// Recursively renders a tab's split tree using draggable AppKit split views.
struct PaneView: View {
    @ObservedObject var node: PaneNode
    @ObservedObject var workspace: Workspace

    var body: some View {
        if node.isLeaf, let session = node.session {
            LeafPaneView(session: session, workspace: workspace)
        } else if node.axis == .horizontal {
            HSplitView {
                ForEach(node.children) { child in
                    PaneView(node: child, workspace: workspace)
                }
            }
        } else {
            VSplitView {
                ForEach(node.children) { child in
                    PaneView(node: child, workspace: workspace)
                }
            }
        }
    }
}

/// A single terminal pane: Warp-style command blocks (history) scroll above a
/// live terminal where you type and the current command runs.
struct LeafPaneView: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var workspace: Workspace

    private var isFocused: Bool { workspace.focusedSessionID == session.id }
    private var isSplit: Bool { (workspace.selectedTab?.sessions.count ?? 1) > 1 }
    private var hasBlocks: Bool { !session.blocks.isEmpty }
    /// A full-screen TUI (Claude Code, vim, …) is drawing — it owns the pane.
    private var tuiActive: Bool { session.tuiActive }
    /// A normal (scrolling) command is currently running — show its live output
    /// under a capped blocks history. Driven by the block lifecycle (reliable),
    /// not by polling the foreground process group.
    private var isRunningCommand: Bool { session.blocks.last?.isRunning == true }

    /// Show the command-block history unless a TUI has taken over the screen.
    private var showBlocks: Bool { hasBlocks && !tuiActive }
    /// Show the live terminal for a TUI, a fresh shell, or a running command.
    private var showTerminal: Bool { tuiActive || !hasBlocks || isRunningCommand }

    @ObservedObject private var settings = AppSettings.shared
    @State private var dropTargeted = false
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            paneHeader
            if tuiActive {
                chatLayout
            } else {
                shellLayout
            }
        }
        .overlay { if dropTargeted { dropOverlay } }
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted, perform: handleDrop)
    }

    /// The pane's title bar — aligned with the rail/files headers (28pt clear for
    /// the traffic lights + a 34pt bar) — carrying the title, process, and close.
    private var paneHeader: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                StatusDot(session: session)
                Text(session.label)
                    .font(settings.ui(12, .medium))
                    .foregroundStyle(Color(isFocused ? theme.foreground : theme.secondaryForeground))
                    .lineLimit(1)
                if !session.isShellForeground {
                    Text(session.processName)
                        .font(settings.mono(10))
                        .foregroundStyle(Color(theme.secondaryForeground))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                closeButton
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            Rectangle()
                .fill(Color(isSplit && isFocused ? theme.accent : theme.border))
                .frame(height: isSplit && isFocused ? 2 : 1)
        }
        .background(Color(theme.chrome))
        .contentShape(Rectangle())
        .onTapGesture { session.onFocusRequested?(session.id) }
    }

    /// "Drop it!" affordance shown while dragging a file over the pane.
    private var dropOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
            VStack(spacing: 12) {
                Image(systemName: "arrow.down.doc.fill")
                    .font(.system(size: 46))
                    .foregroundStyle(Color(theme.accent))
                Text("Drop it!")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
            }
            .padding(28)
            .background(RoundedRectangle(cornerRadius: 18).fill(Color(theme.elevated).opacity(0.9)))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color(theme.accent), lineWidth: 2))
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        for provider in providers {
            provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                guard let data, let url = URL(dataRepresentation: data, relativeTo: nil) else { return }
                DispatchQueue.main.async {
                    if !session.pendingAttachments.contains(url) {
                        session.pendingAttachments.append(url)
                    }
                    // A dropped file is a chat intent — surface the chat box.
                    workspace.focusSession(session.id)
                }
            }
        }
        return true
    }

    /// Close the terminal pane/tab.
    private var closeButton: some View {
        Button(action: { workspace.closeSession(session) }) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Close this terminal (⌘W)")
    }

    /// Claude/TUI mode: a vertical split — the live terminal readout on top, the
    /// chat docked beneath it. The divider is a native, draggable VSplitView
    /// handle (reliable resizing, unlike a custom drag).
    /// Claude/TUI mode toggles between two full-pane views: the chat overlay
    /// (terminal blurred behind it) and the raw, interactive terminal. Only one
    /// input is ever on screen at a time.
    private var chatLayout: some View {
        ZStack(alignment: .topTrailing) {
            TerminalViewRep(session: session)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // `opaque: true` treats the content edges as solid so the blur
                // doesn't fade to a grey halo at the pane edges; clip to bounds.
                .blur(radius: session.revealTerminal ? 0 : settings.terminalBlur, opaque: true)
                .clipped()
                .opacity(session.revealTerminal ? 1 : 0.5)
                .allowsHitTesting(session.revealTerminal)
                .animation(Self.modeAnim, value: session.revealTerminal)

            if !session.revealTerminal {
                // Chat mode: tap the blurred backdrop (outside the card) to reveal
                // the terminal; the chat card floats on top.
                Color.clear.contentShape(Rectangle()).onTapGesture { setReveal(true) }
                chatCard
                    // Collapse into / expand out of the toggle in the top corner.
                    .transition(.scale(scale: 0.04, anchor: .topTrailing).combined(with: .opacity))
            }

            // The mode toggle lives in the top corner, inset to align with the
            // chat card's rounded corner, present in both modes.
            ModeToggle(session: session)
                .padding(.top, 22).padding(.trailing, 22)
        }
    }

    private func setReveal(_ on: Bool) {
        withAnimation(Self.modeAnim) { session.revealTerminal = on }
    }

    /// Quick, slightly-springy collapse/expand between chat and terminal.
    static let modeAnim: Animation = .spring(response: 0.3, dampingFraction: 0.74)

    /// The chat overlay: the chat panel as a translucent card over the blurred
    /// terminal.
    private var chatCard: some View {
        QAChatBox(session: session, workspace: workspace, docked: true)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color(theme.border), lineWidth: 1))
            .shadow(color: .black.opacity(settings.chatShadowOpacity), radius: 26, y: 12)
            .padding(16)
    }

    /// Plain shell mode: command-block history above a live terminal, with the
    /// (collapsed) chat input pinned at the bottom so you can start a chat any time.
    private var shellLayout: some View {
        VStack(spacing: 0) {
            if showBlocks {
                BlocksScrollView(session: session)
                    .frame(maxWidth: .infinity, maxHeight: isRunningCommand ? 220 : .infinity)
            }
            if showTerminal {
                if showBlocks {
                    Rectangle().fill(Color(theme.border)).frame(height: 1)
                }
                TerminalViewRep(session: session)
                    .frame(minWidth: 120, minHeight: 130)
                    .frame(maxHeight: .infinity)
                    .overlay {
                        if !hasBlocks, let logo = Branding.logo {
                            Image(nsImage: logo).resizable().scaledToFit()
                                .frame(width: 150).opacity(0.05)
                                .allowsHitTesting(false)
                        }
                    }
            }
            Rectangle().fill(Color(theme.border)).frame(height: 1)
            QAChatBox(session: session, workspace: workspace, collapsed: true)
                .background(Color(theme.chrome))
        }
    }
}

/// A polished sliding toggle (CSS-checkbox style) switching the pane between the
/// Chat overlay and the raw Terminal. The knob springs under the active icon,
/// the icons bounce, and the whole control dips on press.
private struct ModeToggle: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared
    @State private var pressed = false

    private var theme: Theme { settings.theme }
    private var isTerminal: Bool { session.revealTerminal }

    private let slot: CGFloat = 44
    private let height: CGFloat = 36

    var body: some View {
        ZStack(alignment: isTerminal ? .trailing : .leading) {
            // Track.
            Capsule()
                .fill(Color(theme.surface).opacity(0.95))
                .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))
            // Sliding knob.
            Capsule()
                .fill(settings.actionStyle.fill)
                .frame(width: slot - 6, height: height - 6)
                .padding(3)
                .shadow(color: .black.opacity(0.28), radius: 4, y: 1)
            // Icons.
            HStack(spacing: 0) {
                icon("bubble.left.fill", active: !isTerminal)
                icon("terminal", active: isTerminal)
            }
        }
        .frame(width: slot * 2, height: height)
        // Springy slide for the knob + a press dip for tactile feedback.
        .scaleEffect(pressed ? 0.93 : 1)
        .animation(.spring(response: 0.34, dampingFraction: 0.6), value: isTerminal)
        .animation(.spring(response: 0.25, dampingFraction: 0.55), value: pressed)
        .shadow(color: .black.opacity(0.22), radius: 10, y: 3)
        .contentShape(Capsule())
        .onLongPressGesture(minimumDuration: 0.6, maximumDistance: 40,
                            perform: {}, onPressingChanged: { pressed = $0 })
        .simultaneousGesture(TapGesture().onEnded {
            withAnimation(LeafPaneView.modeAnim) { session.revealTerminal.toggle() }
        })
        .help(isTerminal ? "Switch to chat" : "Switch to the terminal")
    }

    private func icon(_ name: String, active: Bool) -> some View {
        Image(systemName: name)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(active ? .white : Color(theme.secondaryForeground))
            .scaleEffect(active ? 1 : 0.84)
            .symbolEffect(.bounce, value: isTerminal)
            .frame(width: slot, height: height)
    }
}

private struct PaneHeader: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared
    let isFocused: Bool

    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 6) {
            StatusDot(session: session)
            Text(session.label)
                .font(settings.ui(11, .medium))
                .foregroundStyle(Color(isFocused ? theme.foreground : theme.secondaryForeground))
                .lineLimit(1)
            if let status = session.customStatus, !status.isEmpty {
                Text(status)
                    .font(settings.ui(10))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .lineLimit(1)
            }
            Spacer()
            Text(session.processName)
                .font(settings.mono(10))
                .foregroundStyle(Color(theme.secondaryForeground))
            if session.unreadCount > 0 {
                Text("\(session.unreadCount)")
                    .font(.system(size: 9, weight: .bold))
                    .padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Capsule().fill(Color.red))
                    .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 24)
        .background(Color(isFocused ? theme.surfaceHover : theme.chrome))
        .contentShape(Rectangle())
        .onTapGesture { session.onFocusRequested?(session.id) }
    }
}

/// Colored dot indicating session activity: green = running a command,
/// gray = idle shell, red = exited.
struct StatusDot: View {
    @ObservedObject var session: TerminalSession

    private var color: Color {
        if !session.isRunning { return .red }
        if session.hasActivity { return .orange }
        return session.isShellForeground ? .gray : .green
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }
}
