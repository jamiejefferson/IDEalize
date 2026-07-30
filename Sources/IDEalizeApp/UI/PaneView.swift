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
    /// Mini-mode: render the chat full-bleed (no floating card, no terminal
    /// bleed-through) so it reads as a proper mobile chat in the narrow column.
    var compact: Bool = false

    private var isFocused: Bool { workspace.focusedSessionID == session.id }
    private var isSplit: Bool { (workspace.selectedTab?.sessions.count ?? 1) > 1 }
    private var hasBlocks: Bool { !session.blocks.isEmpty }
    /// A full-screen TUI (agent CLI, vim, …) is drawing — it owns the pane.
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
    @ObservedObject private var resizeMonitor = LiveResizeMonitor.shared
    @State private var dropTargeted = false
    /// Set once per view lifetime so the pane opens on its resting view (terminal
    /// visible with the floating solo input) exactly once, then lets the toggle
    /// stick. (req 1)
    @State private var appliedDefaultView = false
    private var theme: Theme { settings.theme }

    /// Height reserved at the terminal's foot so its live output is never hidden
    /// behind the floating solo input — the input floats above this clear strip.
    /// Sized to the resting input's height plus a comfortable margin so the terminal's
    /// last line clears the input top rather than being clipped by it. The focused
    /// input grows well past this, so it still rises up over the terminal's own input
    /// line when you compose. (req 2b / bottom-margin feedback)
    private var floatingInputInset: CGFloat { 136 }

    /// The chat backdrop's Gaussian blur, but never while the window is being
    /// live-resized — blurring a continuously-redrawing terminal NSView every
    /// frame is the single biggest cause of resize judder. It flicks back on the
    /// instant the drag ends.
    private var backdropBlur: CGFloat {
        if session.revealTerminal || resizeMonitor.isResizing { return 0 }
        return settings.terminalBlur
    }

    var body: some View {
        VStack(spacing: 0) {
            // In mini-mode the compact header already carries the chat name and
            // controls, so the pane's own title bar would just be clutter.
            if !compact { paneHeader }
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
        .buttonStyle(.iconHover(padding: 2))
        .help("Close this terminal (⌘W)")
    }

    /// Agent/TUI mode. The floating solo input is pinned to the foot of the pane in
    /// BOTH modes and never moves; the chat/terminal toggle only reveals or hides
    /// the response viewer (the conversation transcript) above it. The terminal
    /// lives behind — sharp and interactive in terminal mode, blurred and dimmed
    /// while the viewer is up. Mini-mode keeps its full-bleed docked chat. (req 6)
    private var chatLayout: some View {
        ZStack(alignment: .topTrailing) {
            TerminalViewRep(session: session)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // `opaque: true` treats the content edges as solid so the blur
                // doesn't fade to a grey halo at the pane edges; clip to bounds.
                .blur(radius: compact ? 0 : backdropBlur, opaque: true)
                .clipped()
                // Mini-mode hides the terminal entirely behind the full-bleed
                // chat (no translucent bleed-through); tap the toggle to reveal it.
                .opacity(session.revealTerminal ? 1 : (compact ? 0 : 0.5))
                .allowsHitTesting(session.revealTerminal)
                .animation(Self.modeAnim, value: session.revealTerminal)
                // Keep the terminal's own last lines clear of the floating input so
                // live output is never hidden beneath it. (req 2b)
                .padding(.bottom, compact && !session.revealTerminal ? 0 : floatingInputInset)

            if compact {
                // Mini-mode: the full-bleed docked chat (transcript + input in one
                // card); the toggle reveals the terminal beneath it.
                if !session.revealTerminal {
                    chatCard
                        .transition(.scale(scale: 0.04, anchor: .topTrailing).combined(with: .opacity))
                } else {
                    // Terminal revealed: the one floating input stays pinned at
                    // the foot of the column — the composer is never out of
                    // reach in mini-mode. Mirrors the desktop layout below.
                    QAChatBox(session: session, workspace: workspace, collapsed: true)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                }
            } else {
                // Chat mode: tap the exposed terminal margin to reveal the terminal.
                if !session.revealTerminal {
                    Color.clear.contentShape(Rectangle()).onTapGesture { setReveal(true) }
                }
                // The response viewer and the one fixed input, laid out bottom-up.
                // The input is a single instance pinned to the bottom in both modes;
                // only the viewer above it appears/disappears with the toggle, so
                // the input's instance and position never change. (req 6) Its own
                // single lifted container is the lozenge's — no outer wrapper. (req 2a)
                VStack(spacing: 0) {
                    if !session.revealTerminal {
                        responseViewer
                            // Collapse into / expand out of the toggle in the corner.
                            .transition(.scale(scale: 0.04, anchor: .topTrailing).combined(with: .opacity))
                    }
                    QAChatBox(session: session, workspace: workspace, collapsed: true)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }

            // Jump up/down through the conversation — mirrors the mode toggle in the
            // opposite (top-left) corner, same inset and pill styling.
            if !session.revealTerminal, session.exchanges.count > 1 {
                ExchangeNav(session: session)
                    .padding(.top, 22).padding(.leading, 22)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .transition(.opacity)
            }

            // The chat/terminal mode toggle sits in the terminal's top-right corner,
            // reachable in either mode: it reveals or hides the response viewer above
            // the unchanged input. Mirrors ExchangeNav opposite.
            ModeToggle(session: session)
                .tourTarget(.modeToggle)
                .padding(.top, 22).padding(.trailing, 22)
        }
        // The ground behind the floating input (the reserved strip the terminal is
        // padded off of) is painted in the terminal's own background, so the input
        // sits on the same paper as the terminal above it rather than on the window
        // chrome. The terminal is opaque and covers the rest.
        .background(Color(settings.terminalTheme.background))
        .onAppear {
            // req 1: an agent pane opens on its resting view — terminal visible with
            // the floating solo input — rather than the docked chat card. Applied
            // once per view lifetime, and never over a login/prompt the chat viewer
            // needs to surface, so those flows still land in the transcript.
            // Mini-mode is the exception: the chat (messages + composer) is the
            // default focus of the narrow column (spec §5.4), so the compact pane
            // never forces the terminal forward on appear.
            guard !appliedDefaultView else { return }
            appliedDefaultView = true
            if !compact, session.loginState == .none && session.pendingPrompt == nil {
                session.revealTerminal = true
            }
        }
    }

    /// The response viewer shown above the fixed input in chat mode: the shared
    /// conversation transcript (carrying the working animation and any prompts),
    /// dressed as a lifted card. It appears/disappears with the toggle while the
    /// input beneath it stays put. (req 6)
    private var responseViewer: some View {
        QAChatBox(session: session, workspace: workspace, viewerOnly: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color(theme.border), lineWidth: 1))
            .shadow(color: .black.opacity(settings.chatShadowOpacity), radius: 26, y: 12)
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 8)
    }

    private func setReveal(_ on: Bool) {
        withAnimation(Self.modeAnim) { session.revealTerminal = on }
    }

    /// Quick, slightly-springy collapse/expand between chat and terminal.
    static let modeAnim: Animation = .spring(response: 0.3, dampingFraction: 0.74)

    /// The chat overlay: the chat panel as a translucent card over the blurred
    /// terminal.
    @ViewBuilder private var chatCard: some View {
        if compact {
            // Full-bleed chat: fills the narrow column, opaque so the hidden
            // terminal never shows through. No card inset / rounding / shadow.
            QAChatBox(session: session, workspace: workspace, docked: true)
                .background(Color(theme.background))
        } else {
            QAChatBox(session: session, workspace: workspace, docked: true)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color(theme.border), lineWidth: 1))
                .shadow(color: .black.opacity(settings.chatShadowOpacity), radius: 26, y: 12)
                .padding(16)
        }
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
struct ModeToggle: View {
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

/// Jump up/down through the conversation's exchanges. Lives in the chat's
/// top-left corner, mirroring `ModeToggle` opposite it — same surface pill,
/// border and shadow. Up steps to an earlier exchange, down returns toward the
/// newest (and back to live); the transcript watches `historyIndex` to scroll.
private struct ExchangeNav: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 6) {
            arrow("chevron.up", enabled: session.canGoBack, help: "An earlier reply") { session.historyBack() }
            Text("\(session.shownIndex + 1) of \(session.exchanges.count)")
                .font(settings.ui(11, .semibold)).monospacedDigit()
                .foregroundStyle(Color(theme.foreground))
                .fixedSize()
            arrow("chevron.down", enabled: session.canGoForward, help: "A later reply") { session.historyForward() }
        }
        .padding(.horizontal, 10).frame(height: 36)
        .background(
            Capsule()
                .fill(Color(theme.surface).opacity(0.95))
                .overlay(Capsule().strokeBorder(Color(theme.border), lineWidth: 1))
        )
        .shadow(color: .black.opacity(0.22), radius: 10, y: 3)
        .help("Jump up and down through the conversation")
    }

    private func arrow(_ icon: String, enabled: Bool, help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(enabled ? settings.actionStyle.color
                                         : Color(theme.secondaryForeground).opacity(0.35))
                .frame(width: 22, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.iconHover(padding: 2)).disabled(!enabled).help(help)
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
