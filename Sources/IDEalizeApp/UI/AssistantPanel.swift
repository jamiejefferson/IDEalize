import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Scales the chat's type down proportionally without touching the user's own
/// font-size setting — mini-mode sets this so a "large" chat stays relatively
/// large but fits the narrow column. Defaults to 1 (no scaling) everywhere else.
private struct ChatFontScaleKey: EnvironmentKey { static let defaultValue: CGFloat = 1 }
extension EnvironmentValues {
    var chatFontScale: CGFloat {
        get { self[ChatFontScaleKey.self] }
        set { self[ChatFontScaleKey.self] = newValue }
    }
}

/// A flashing accent caret shown where the input rests — the deliberate stand-in
/// for the old prompt chevron. It fades in and out on a slow blink; the native
/// text caret takes over the moment the field is focused, so the two never
/// compete (the caller hides this one then).
private struct InputCursor: View {
    let color: Color
    let height: CGFloat
    @State private var on = true
    var body: some View {
        Capsule()
            .fill(color)
            .frame(width: 2, height: height)
            .opacity(on ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    on = false
                }
            }
    }
}

/// The unified agent chat box: your latest question (condensed) on top, a
/// gentle divider, then the agent's answer, then the input — all in one card that
/// floats over a blurred view of the terminal "thinking" behind it.
struct QAChatBox: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var workspace: Workspace
    /// Slim form (just the input) used in plain-shell mode before a chat exists.
    var collapsed: Bool = false
    /// Docked form: fills the bottom of a VSplitView (terminal on top). The split
    /// divider handles resizing, so there's no in-view resize handle.
    var docked: Bool = false
    /// Viewer form: just the response viewer (conversation transcript, prompts and
    /// the working animation), with no input. PaneView stacks this above the one
    /// fixed floating input so the chat/terminal toggle only reveals or hides the
    /// transcript — the input itself never moves. (req 6)
    var viewerOnly: Bool = false
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var speech = SpeechDictation.shared
    @State private var text = ""
    @State private var micBase = ""
    @State private var thanksHover = false
    @State private var keyMonitor: Any?
    /// The highlighted option in a single-select agent prompt. Hover moves it,
    /// click answers immediately, Return answers the highlighted one.
    @State private var selectedOption = 1
    /// When true, the chat region shows the Flows designer instead of the answer.
    @State private var flowMode = false
    /// The flow being sketched — a single global document (like a skill), the same
    /// in every session and tab. Every chat box observes the one shared store, so
    /// edits and agent reloads in any pane are visible in all of them (per-pane
    /// stores used to overwrite each other's debounced saves). Persisted to the
    /// app's global flow path.
    @ObservedObject private var flowStore = FlowStore.shared
    /// The guided interview that builds the flow conversation-first.
    @StateObject private var interview = FlowsInterview()
    /// True from sending a flow to the agent until its turn ends — drives the editor's
    /// spinner and triggers the review reload when the agent finishes.
    @State private var reviewingFlow = false
    /// True while the agent is carrying out the flow (the verdict-gated Run).
    @State private var runningFlow = false
    /// True from asking the agent to apply its review suggestions until its turn ends —
    /// drives the editor's spinner and triggers the improved-flow reload.
    @State private var improvingFlow = false
    @FocusState private var focused: Bool
    /// Scroll anchor pinned to the end of the transcript, so a streaming reply
    /// follows live to the bottom while we're at the newest message.
    private static let answerBottomID = "answer-bottom"
    /// True while the bottom sentinel is on screen — i.e. we're following the
    /// newest message. New content auto-scrolls only then, so jumping up to read
    /// earlier turns isn't yanked back down.
    @State private var atBottom = true

    /// Proportional type scale (1 = normal; mini-mode passes a smaller value).
    @Environment(\.chatFontScale) private var chatFontScale
    private var theme: Theme { settings.theme }
    private var size: CGFloat { settings.chatFontSize * chatFontScale }
    private var chatStyle: PanelStyle { settings.panelStyle(.chat, base: settings.chatFontSize * chatFontScale, background: theme.background) }
    /// Chat text colour: the Chat panel's override if set, else the theme's.
    /// (Single source — there is no separate global chat-colour setting.)
    private var chatTextColor: Color { chatStyle.textColor }
    private var working: Bool { session.botWorking }

    /// Approx height of one line of chat input at the current font + line spacing.
    private var chatLineHeight: CGFloat { size * 1.2 + CGFloat(settings.chatInputLineSpacing) }
    /// Active/standby height for the focused composer: comfortably holds five-plus
    /// lines before it has to scroll (the field itself keeps growing to ~14 lines,
    /// then scrolls), and — sized generously at ~6.5 lines — it also rises up over the
    /// terminal's own input line beneath it (the reserved strip plus the terminal
    /// margin), so composing hides the shell prompt rather than leaving it peeking
    /// above the panel. Derived from the metrics so it tracks the chat font + spacing.
    private var expandedInputHeight: CGFloat { chatLineHeight * 6.5 }
    /// Nudge the resting caret + first text line down onto the 28pt send button's
    /// centre line, so they read as one row instead of the caret floating above the
    /// button; extra lines still grow downward from there. Clamped for large fonts. (req 3)
    private var firstLineInset: CGFloat { max(0, (28 - chatLineHeight) / 2) }

    var body: some View {
        if viewerOnly {
            // The response viewer on its own — carries the docked chat background so
            // PaneView only has to add the card's rounding, border and shadow.
            conversationPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(dockedBackground)
        } else if collapsed {
            inputLozenge
                .padding(.horizontal, 14).padding(.vertical, 8)
        } else {
            dockedView
        }
    }

    /// The chat docked beneath the terminal. One pane, two faces: the
    /// conversation (question on top, answer scrolling) or — when the flow toggle
    /// is on — the flow builder (its toggle + library header on top, the editable
    /// spine filling the body). Either way the input is pinned at the bottom, so
    /// in flow mode you can still type a note to send alongside the flow.
    private var dockedView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Chat mode: the conversation fills the pane, the input sits beneath
            // it. Flow mode: the input container itself grows up to fill the pane
            // and hold the builder, so the conversation steps aside entirely.
            if !flowMode {
                conversationPane
                Rectangle().fill(Color(theme.border).opacity(0.5)).frame(height: 1)
            }
            inputLozenge
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxHeight: flowMode ? .infinity : nil, alignment: .bottom)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(dockedBackground)
    }

    /// A single message turn shown in the transcript — the user's question and
    /// (once it arrives) the agent's answer to it.
    private struct ChatTurn: Identifiable {
        let id: Int
        let question: String
        let answer: String?
    }

    /// The conversation as an ordered list of turns, oldest→newest. Appends an
    /// optimistic pending turn for a just-sent message the transcript hasn't
    /// recorded yet (so your message shows instantly); it drops the moment the
    /// real exchange lands with the same question, so there's never a duplicate.
    private var turns: [ChatTurn] {
        var out = session.exchanges.map { ChatTurn(id: $0.index, question: $0.question, answer: $0.answer) }
        if let q = session.userQuestion, !q.isEmpty, session.exchanges.last?.question != q {
            out.append(ChatTurn(id: -1, question: q, answer: nil))
        }
        return out
    }

    /// The scroll id for a turn's user message, so the jump-nav can scroll to it.
    private func turnAnchor(_ id: Int) -> String { "turn-\(id)" }

    /// Chat face: the whole conversation, oldest at top and newest just above the
    /// input, so it reads top-to-bottom and new turns push older ones up. The
    /// newest turn carries the live working animation (or a prompt) beneath it.
    @ViewBuilder private var conversationPane: some View {
        if !settings.hasSeenWelcome {
            // First-run welcome takes priority over everything else.
            ScrollView {
                welcomeCard
                    .padding(.horizontal, settings.chatMargin).padding(.bottom, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if turns.isEmpty {
            emptyStatePane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            transcript
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// The scrolling conversation. Bottom-anchored: it auto-follows the newest
    /// message while you're at the bottom, and steps aside quietly when you've
    /// jumped up to read earlier turns.
    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(turns) { turn in
                        userMessageRow(turn.question).id(turnAnchor(turn.id))
                        if let a = turn.answer, !a.isEmpty { answerBubble(a) }
                        if turn.id == turns.last?.id { liveTrailing }
                    }
                    // Bottom sentinel: whether it's on screen tells us if we're
                    // following live, and it's the target we scroll new content to.
                    Color.clear.frame(height: 1).id(Self.answerBottomID)
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.horizontal, settings.chatMargin)
                // Clear the top-left jump-nav pill (which floats over the card) so
                // it never sits on top of the oldest message.
                .padding(.top, session.exchanges.count > 1 ? 44 : 16)
                .padding(.bottom, 8)
            }
            .onChange(of: session.userQuestion) { _, _ in
                // A message I just sent always brings me back to the conversation.
                atBottom = true
                withAnimation { proxy.scrollTo(Self.answerBottomID, anchor: .bottom) }
            }
            .onChange(of: session.assistantMessage) { _, _ in
                if atBottom { proxy.scrollTo(Self.answerBottomID, anchor: .bottom) }
            }
            .onChange(of: session.exchanges.count) { _, _ in
                if atBottom { withAnimation { proxy.scrollTo(Self.answerBottomID, anchor: .bottom) } }
            }
            .onChange(of: session.pendingPrompt) { _, _ in
                if atBottom { withAnimation { proxy.scrollTo(Self.answerBottomID, anchor: .bottom) } }
            }
            // The jump-nav sets historyIndex; scroll to that turn (or back to the
            // newest when it returns to live).
            .onChange(of: session.historyIndex) { _, idx in
                if let idx, session.exchanges.indices.contains(idx) {
                    withAnimation { proxy.scrollTo(turnAnchor(session.exchanges[idx].index), anchor: .top) }
                } else {
                    withAnimation { proxy.scrollTo(Self.answerBottomID, anchor: .bottom) }
                }
            }
            .onAppear { proxy.scrollTo(Self.answerBottomID) }
        }
    }

    /// The live region beneath the newest user message: Claude's answer streams in
    /// above this, and while a turn is in flight the working animation shows here —
    /// so a fresh message always reads "your message → working → reply".
    @ViewBuilder private var liveTrailing: some View {
        if session.loginState == .succeeded {
            loginBanner
        } else if !session.isBrowsingHistory, let prompt = session.pendingPrompt {
            promptView(prompt)
        } else if session.loginState == .inProgress {
            loginBanner
        } else if !session.isBrowsingHistory && session.liveInteractivePrompt && !working {
            terminalAttentionView
        } else if isActiveTurn {
            workingBanner
        }
    }

    /// Empty conversation: the returning-user "ready" greeting or the service-hatch
    /// banner, shown until the first turn arrives.
    private var emptyStatePane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if session.loginState != .none {
                    loginBanner
                } else if session.isServiceHatch {
                    hatchBanner
                } else if showReady {
                    readyView
                }
                // Before any turn exists the agent can still put up a choice box —
                // the login-method picker most notably. Surface it here so it's
                // answerable from the chat, not only in the terminal.
                if let prompt = session.pendingPrompt, !session.isBrowsingHistory {
                    promptView(prompt)
                }
            }
            .padding(.horizontal, settings.chatMargin)
            .padding(.top, 16).padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Send the sketched flow to the agent for review. The pre-flight already gated
    /// the button, so by here the structure is sound. We flush the file (the agent
    /// reads it), close the editor so the work is visible, and run `/flow-review`;
    /// `onChange(botWorking)` reloads the verdict when the turn ends.
    private func reviewFlow() {
        flowStore.flushSave()
        reviewingFlow = true
        withAnimation(LeafPaneView.modeAnim) { flowMode = false }
        session.runCommand("/flow-review")
    }

    /// Ask the agent to apply its own review suggestions to the flow. Flushes the file
    /// (the agent reads it), closes the editor so the work is visible, and runs
    /// `/flow-improve`; `onChange(botWorking)` adopts the rewritten flow and reopens
    /// the editor when the turn ends.
    private func improveFlow() {
        flowStore.flushSave()
        improvingFlow = true
        withAnimation(LeafPaneView.modeAnim) { flowMode = false }
        session.runCommand("/flow-improve")
    }

    /// Adopt the interview-built flow and hand it to the agent to run.
    private func runInterviewFlow(_ flow: Flow) {
        flowStore.flow = flow
        flowStore.flushSave()
        sendFlow()
    }

    /// Adopt the interview-built flow and save it into the library.
    private func saveInterviewFlow(_ flow: Flow) {
        flowStore.flow = flow
        flowStore.saveCurrent(named: flow.title)
    }

    /// Hand the interview over to the terminal AI. Writes the current session to
    /// `flows-session.json` and runs `/flows` so the agent can continue the
    /// conversation and write the resulting flow to `flow.json`.
    private func askAgentToInterview() {
        interview.exportSession()
        session.runCommand("/flows")
    }

    /// True when the working flow is worth handing to the agent: it has steps and no
    /// blocking structural errors. Drives the input's send arrow in flow mode.
    private var canSendFlow: Bool {
        !flowStore.flow.flow.blocks.isEmpty &&
        !flowStore.flow.flow.validate().contains { $0.severity == .error }
    }

    /// The primary "send to the agent" path for a flow: hand it over to be carried
    /// out. Bound to the input's send arrow while in flow mode. Flushes the file,
    /// closes the editor to watch the work, and runs `/flow-run`.
    /// True when the working flow has a stopped run to pick up — the send arrow
    /// then reads as Resume rather than a fresh send.
    private var flowIsResumable: Bool { flowStore.resumableRun != nil }

    private func sendFlow() {
        guard canSendFlow else { return }
        // A fresh send forgets stale progress (a finished or abandoned run) so the
        // skill starts from the top; a resumable run is left intact so it picks up
        // from where it stopped. The skill decides start-vs-resume from the file.
        if !flowIsResumable { flowStore.clearRun() }
        flowStore.flushSave()
        runningFlow = true
        withAnimation(LeafPaneView.modeAnim) { flowMode = false }
        // Any text typed in the input rides along as an extra instruction for the run.
        let note = text.trimmingCharacters(in: .whitespacesAndNewlines)
        session.runCommand(note.isEmpty ? "/flow-run" : "/flow-run \(note)")
        text = ""
    }

    /// The chat card (modal) background. A custom Chat appearance carries its own
    /// opacity (the per-panel BACKGROUND ▸ Opacity slider is the single modal
    /// transparency control); otherwise a sensible translucent default lets the
    /// blurred terminal show through.
    @ViewBuilder private var dockedBackground: some View {
        if chatStyle.hasCustomBackground {
            chatStyle.background
        } else {
            Color(theme.background).opacity(0.82)
        }
    }

    /// The input lozenge fill — adopts the Chat panel's custom colour (slightly
    /// elevated) when one is set, else the theme's elevated surface.
    private var inputFill: Color {
        let a = settings.appearance(.chat)
        if a.bgMode == FillMode.solid.rawValue, let c = NSColor(hex: a.bgColorHex) {
            // Honour the picked colour exactly — a chosen white must read as white at
            // full opacity, not a greyed-down blend. (This used to blend 12% toward
            // the foreground for a faux-elevated look, which muddied a full-white pick.)
            return Color(c)
        }
        return Color(theme.elevated)
    }

    /// Hold Right Option (⌥) anywhere to dictate into this chat.
    private func installDictationKey() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged]) { event in
            if event.keyCode == 61 { // right option
                if event.modifierFlags.contains(.option) { startDictation() } else { endDictation() }
            }
            return event
        }
    }

    private func removeDictationKey() {
        if let m = keyMonitor { NSEvent.removeMonitor(m); keyMonitor = nil }
    }

    /// A warm, non-technical first-run welcome shown in the chat.
    private var welcomeCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 10) {
                Text("👋").font(.system(size: 26))
                Text("Welcome to IDEalize")
                    .font(chatStyle.font(size + 5, .semibold)).foregroundStyle(chatTextColor)
            }
            Text("This is your AI workspace — no coding needed. Just tell your agent what you'd like to do, in plain English, and it gets to work.")
                .font(chatStyle.font(size)).foregroundStyle(chatTextColor)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 9) {
                welcomeBullet("sidebar.left", "On the left — your sessions and files.")
                welcomeBullet("bubble.left.and.bubble.right.fill", "Right here — chat with your assistant.")
                welcomeBullet("paintpalette", "Bottom bar — change how everything looks, any time.")
            }
            Text("Tap one to get started — or just type your own below:")
                .font(chatStyle.font(size - 1)).foregroundStyle(chatStyle.secondaryTextColor)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Self.welcomeExamples, id: \.self) { exampleChip($0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static let welcomeExamples = [
        "Help me write an email",
        "Plan out my week",
        "Summarise a document for me",
    ]

    /// A tappable example prompt — drops the text into the input, ready to send.
    private func exampleChip(_ prompt: String) -> some View {
        Button(action: { useExample(prompt) }) {
            HStack(spacing: 9) {
                Image(systemName: "text.bubble").font(.system(size: 12))
                    .foregroundStyle(settings.actionStyle.color)
                Text(prompt).font(chatStyle.font(size - 1)).foregroundStyle(chatTextColor)
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.forward").font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(chatStyle.secondaryTextColor)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 10).fill(settings.actionStyle.color.opacity(0.10)))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(settings.actionStyle.color.opacity(0.28), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Stage an example in the input and dismiss the welcome (one-click start).
    private func useExample(_ prompt: String) {
        text = prompt
        settings.hasSeenWelcome = true
        focused = true
    }

    private func welcomeBullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.system(size: 13))
                .foregroundStyle(settings.actionStyle.color).frame(width: 18)
            Text(text).font(chatStyle.font(size - 1)).foregroundStyle(chatTextColor)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func dismissWelcome() {
        settings.hasSeenWelcome = true
        focused = true
    }

    /// A user message in the transcript — the person glyph and the full prompt,
    /// never truncated. A subtle neutral fill marks it as "your" side, setting it
    /// apart from Claude's tinted answers just below.
    private func userMessageRow(_ q: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 20)
                .padding(.top, size * 0.16)
            Text(q)
                .font(chatStyle.font(size - 1, .medium))
                .tracking(chatStyle.tracking)
                .foregroundStyle(chatStyle.secondaryTextColor)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(theme.secondaryForeground).opacity(0.06))
        )
    }

    /// No conversation yet in this session — no answer, question, or history.
    private var chatIsEmpty: Bool {
        session.exchanges.isEmpty
            && (session.displayedAnswer?.isEmpty ?? true)
            && (session.userQuestion?.isEmpty ?? true)
    }

    /// Show the "agent is ready" greeting: the agent is loaded and idle, the chat
    /// is blank, and we're past first-run (the welcome card owns that case). It's a
    /// returning-user confirmation that the agent is up and waiting for a prompt.
    private var showReady: Bool {
        settings.hasSeenWelcome
            && session.isAgentRunning
            && chatIsEmpty
            && !working
            && session.pendingPrompt == nil
            && !session.liveInteractivePrompt
            && !session.isBrowsingHistory
            && session.loginState == .none    // the login banner owns this moment
    }

    /// A light, friendly "the agent is up — your move" message for an empty chat.
    private var readyView: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 15))
                .foregroundStyle(Color(theme.accent))
                .frame(width: 20)
                .padding(.top, size * 0.16)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(session.currentAgent?.name ?? "Agent") is ready")
                    .font(chatStyle.font(size, .semibold))
                    .foregroundStyle(chatTextColor)
                Text("Tell it what you'd like to do, in plain English — type below to get started.")
                    .font(chatStyle.font(size - 1))
                    .foregroundStyle(chatStyle.secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }

    /// The sign-in banner: "signing in…" while the OAuth flow runs, then a clear
    /// "you're signed in" confirmation once the terminal reports success — so the
    /// login, which otherwise plays out invisibly in the terminal, reads plainly
    /// in the chat and its success isn't missed.
    @ViewBuilder private var loginBanner: some View {
        if session.loginState == .succeeded {
            loginSucceededCard
        } else {
            loginInProgressCard
        }
    }

    /// Sign-in underway. When the agent is showing its method picker the options
    /// render just below (in the empty state), so this is a header; at the
    /// browser/paste-the-code stage there's no in-chat prompt, so it points the
    /// user to finish in the browser and offers a jump to the terminal to paste
    /// the code.
    private var loginInProgressCard: some View {
        let atPicker = session.pendingPrompt != nil
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield")
                .font(.system(size: 15))
                .foregroundStyle(Color(theme.accent))
                .frame(width: 20)
                .padding(.top, size * 0.16)
            VStack(alignment: .leading, spacing: 6) {
                Text("Signing in to \(session.currentAgent?.name ?? "your agent")")
                    .font(chatStyle.font(size, .semibold))
                    .foregroundStyle(chatTextColor)
                Text(atPicker
                     ? "Choose how you'd like to sign in below."
                     : "A browser window has opened — finish signing in there. If it shows a code, paste it into the terminal.")
                    .font(chatStyle.font(size - 1))
                    .foregroundStyle(chatStyle.secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !atPicker {
                    Button(action: { withAnimation(LeafPaneView.modeAnim) { session.revealTerminal = true } }) {
                        HStack(spacing: 7) {
                            Image(systemName: "terminal")
                            Text("Open the terminal").font(settings.ui(size - 1, .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill(settings.actionStyle.fill))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }

    /// Signed in — a warm confirmation the raw terminal only flashes for a moment.
    private var loginSucceededCard: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 15))
                .foregroundStyle(settings.actionStyle.color)
                .frame(width: 20)
                .padding(.top, size * 0.16)
            VStack(alignment: .leading, spacing: 4) {
                Text("You're signed in to \(session.currentAgent?.name ?? "your agent")")
                    .font(chatStyle.font(size, .semibold))
                    .foregroundStyle(chatTextColor)
                Text("All set — tell it what you'd like to do below to get started.")
                    .font(chatStyle.font(size - 1))
                    .foregroundStyle(chatStyle.secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }

    /// The Service Hatch opening banner — a playful sci-fi "warning" shown in a
    /// fresh hatch tab's chat while the agent spins up on IDEalize's own source. Gives
    /// way to the live conversation the moment the agent's first reply lands.
    private var hatchBanner: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "wrench.and.screwdriver.fill")
                .font(.system(size: 15))
                .foregroundStyle(settings.actionStyle.color)
                .frame(width: 20)
                .padding(.top, size * 0.16)
            VStack(alignment: .leading, spacing: 8) {
                Text("Warning, Service Hatch Open…")
                    .font(chatStyle.font(size, .semibold))
                    .foregroundStyle(chatTextColor)
                Text("“Sir, I don't know where your ship learned to communicate, but it has the most peculiar dialect”")
                    .font(chatStyle.font(size - 1).italic())
                    .foregroundStyle(chatStyle.secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                Text("What would you like to do")
                    .font(chatStyle.font(size - 1))
                    .foregroundStyle(chatTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                Text("“You watch your language!”")
                    .font(chatStyle.font(size - 1).italic())
                    .foregroundStyle(chatStyle.secondaryTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                if !session.isAgentRunning {
                    Text("Agent is starting…")
                        .font(chatStyle.font(size - 2))
                        .foregroundStyle(chatStyle.secondaryTextColor.opacity(0.8))
                        .padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity)
    }

    /// Placeholder hint for the input: a flow note, or — when the agent is showing a
    /// single-pick prompt — that you can type your own answer instead of choosing.
    private var inputPlaceholder: String? {
        if flowMode { return "Add a note for the agent (optional)…" }
        if let p = session.pendingPrompt, !p.isMultiSelect { return "Pick an option, or type your own answer…" }
        // The empty-state prompt — drawn dimmed in the user's chat input font by the
        // messageField overlay, matching the redesign's opening line. (req 9)
        return "What do you want to Idealize?"
    }

    /// A live, in-flight agent turn. `awaitingReply` covers the moment right after
    /// you hit send, before the agent has drawn its on-screen "working" marker — so
    /// the working animation appears the instant you send, beneath your new message.
    private var isActiveTurn: Bool {
        session.pendingPrompt == nil && (working || session.awaitingReply)
    }

    /// The agent's finished reply, rendered as markdown with a copy button.
    private func answerBubble(_ a: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 15))
                    .foregroundStyle(Color(theme.accent))
                    .frame(width: 20)
                    .padding(.top, size * 0.16)
                // The enclosing panel provides the scroll when it's at a fixed
                // height; here we just lay out the prose.
                MarkdownText(text: a, baseSize: size).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 12) {
                Spacer()
                Button(action: { copyToPasteboard(a) }) {
                    Image(systemName: "doc.on.doc").font(.system(size: size - 4))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }.buttonStyle(.iconHover(padding: 3)).help("Copy response")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(theme.foreground).opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color(theme.border).opacity(0.4), lineWidth: 1)
                )
        )
    }

    /// The inline "what the agent's doing" line shown above the pinned answer while a
    /// turn runs, beneath the newest message: a pulsing spark, the working status
    /// (time · tokens), and the agent's current tip. The reply itself streams into the
    /// answer bubble just above, so this stays a compact "still working" line.
    private var workingBanner: some View {
        HStack(alignment: .center, spacing: 12) {
            // One critter per task (fixed at send, stable across the turn); the
            // ground/dust are drawn in the neutral secondary colour, never accent.
            WorkingCritter(tint: Color(theme.secondaryForeground),
                           seed: session.taskCritter, size: 28)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text("Working…")
                        .font(chatStyle.font(size, .semibold))
                        .foregroundStyle(chatTextColor)
                    if let s = session.workingStatus, !s.isEmpty {
                        Text(s).font(chatStyle.font(size - 3)).monospacedDigit()
                            .foregroundStyle(chatStyle.secondaryTextColor)
                    }
                }
                if let tip = session.workingTip, !tip.isEmpty {
                    Text(tip)
                        .font(chatStyle.font(size - 2))
                        .foregroundStyle(chatStyle.secondaryTextColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(theme.foreground).opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color(theme.border).opacity(0.5), lineWidth: 1)
                )
        )
    }

    /// The agent is asking a question — show it with answer buttons.
    private func promptView(_ prompt: AgentPrompt) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "questionmark.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Color(theme.accent))
                    .frame(width: 20)
                    .padding(.top, size * 0.16)
                Text(prompt.question)
                    .font(chatStyle.font(size, .medium))
                    .tracking(chatStyle.tracking)
                    .foregroundStyle(chatTextColor)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(spacing: 8) {
                ForEach(prompt.options) { opt in
                    if opt.checkState != .none {
                        checkboxRow(opt)          // multi-select: tap to toggle
                    } else {
                        actionRow(opt, selected: !prompt.isMultiSelect && opt.number == selectedOption)
                    }
                }
                if prompt.isMultiSelect {
                    Button(action: { session.confirmPrompt() }) {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark").font(.system(size: size - 3, weight: .bold))
                            Text("Done").font(settings.ui(size - 1, .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 10).fill(settings.actionStyle.fill))
                    }
                    .buttonStyle(.plain).padding(.top, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Reset the highlight to the first option whenever a new prompt appears.
        .onChange(of: prompt.question) { _, _ in selectedOption = 1 }
    }

    /// A tappable checkbox option (multi-select). Tapping toggles it in the agent;
    /// the screen re-parses and the tick updates.
    private func checkboxRow(_ opt: AgentPrompt.Option) -> some View {
        let on = opt.checkState == .checked
        return Button(action: { session.togglePromptOption(opt) }) {
            HStack(spacing: 11) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: size)).foregroundStyle(on ? settings.actionStyle.color : Color(theme.secondaryForeground))
                Text(opt.label).font(chatStyle.font(size - 1)).tracking(chatStyle.tracking)
                    .foregroundStyle(chatTextColor).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(theme.surface).opacity(0.7)))
            .overlay(RoundedRectangle(cornerRadius: 10)
                .strokeBorder(on ? settings.actionStyle.color.opacity(0.5) : Color(theme.border).opacity(0.6), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    /// A single-pick / action option (sends its number and proceeds). The
    /// highlighted row tracks `selectedOption`; hovering moves the highlight,
    /// clicking answers immediately, and Return answers the highlighted one.
    private func actionRow(_ opt: AgentPrompt.Option, selected: Bool) -> some View {
        Button(action: { session.answerPrompt(opt) }) {
            HStack(spacing: 10) {
                Text("\(opt.number)")
                    .font(chatStyle.font(size - 2, .bold))
                    .foregroundStyle(selected ? .white : Color(theme.secondaryForeground))
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(selected ? settings.actionStyle.fill : AnyShapeStyle(Color(theme.surface))))
                Text(opt.label)
                    .font(chatStyle.font(size - 1)).tracking(chatStyle.tracking)
                    .foregroundStyle(chatTextColor).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10)
                .fill(selected ? AnyShapeStyle(settings.actionStyle.color.opacity(0.10))
                               : AnyShapeStyle(Color(theme.surface).opacity(0.7))))
            .overlay(RoundedRectangle(cornerRadius: 10)
                .strokeBorder(selected ? settings.actionStyle.color.opacity(0.7) : Color(theme.border).opacity(0.6),
                              lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .onHover { if $0 { selectedOption = opt.number } }
    }

    /// Shown when the agent is sitting on an interactive prompt the chat can't
    /// render (an arrow-key menu, a trust dialog). Keeps the chat honest about
    /// the live state and sends you to the terminal to answer.
    private var terminalAttentionView: some View {
        VStack(spacing: 12) {
            Image(systemName: "keyboard.badge.ellipsis")
                .font(.system(size: 30))
                .foregroundStyle(Color(theme.accent)).opacity(0.85)
            Text("\(session.currentAgent?.name ?? "Agent") is waiting for you in the terminal")
                .font(chatStyle.font(size, .medium))
                .foregroundStyle(chatTextColor)
                .multilineTextAlignment(.center)
            Text("It's showing a prompt the chat can't display. Open the terminal to answer it.")
                .font(chatStyle.font(size - 2))
                .foregroundStyle(chatStyle.secondaryTextColor)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { withAnimation(LeafPaneView.modeAnim) { session.revealTerminal = true } }) {
                HStack(spacing: 7) {
                    Image(systemName: "terminal")
                    Text("Open the terminal").font(settings.ui(size - 1, .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Capsule().fill(settings.actionStyle.fill))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.horizontal, 24).padding(.vertical, 16)
    }

    /// A delicate lozenge around the input, reorganised to the sketch: a flashing
    /// accent cursor and the growing field up top with the send + thanks actions
    /// stacked beside it, and a control strip — action pills on the left, input
    /// controls on the right — pinned along the bottom.
    private var inputLozenge: some View {
        // Tapping the field expands the composing area (standby → active): more
        // room to write, and — floating over the terminal — it grows up to cover
        // the terminal's own input line. Tapping away drops focus and it settles
        // back. Only the floating/standby form expands; the docked form already
        // fills its pane. And only over a TUI, where the input floats as an
        // overlay: in plain-shell mode the bar sits in the pane's layout, so
        // expanding there would squeeze the terminal grid and force a reflow —
        // the terminal must never resize to track the composer's expansion.
        let expanded = collapsed && focused && session.tuiActive
        return VStack(alignment: .leading, spacing: 8) {
            // Flow mode: the conversation-first designer lives inside this same
            // container, which has grown upward to hold it. The interview fills the
            // body; the note field stays pinned at the bottom so you can add an
            // instruction to send with the flow.
            if flowMode {
                Rectangle().fill(Color(theme.border).opacity(0.45)).frame(height: 1)
                    .padding(.vertical, 1)
                FlowsBuilderView(interview: interview,
                                 onRun: { flow in runInterviewFlow(flow) },
                                 onSave: { flow in saveInterviewFlow(flow) },
                                 onAskAgent: askAgentToInterview,
                                 agentAvailable: session.isAgentRunning)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Rectangle().fill(Color(theme.border).opacity(0.45)).frame(height: 1)
                    .padding(.vertical, 1)
            }
            if !session.pendingAttachments.isEmpty {
                attachmentChips
            }

            // Composing row: a flashing accent cursor (in place of the old prompt
            // chevron) beside the growing field, with the send + thanks actions
            // stacked at the top-right corner of the lozenge.
            HStack(alignment: .top, spacing: 10) {
                HStack(alignment: .top, spacing: 7) {
                    // A flashing accent caret marks the resting input; the native
                    // caret takes over the instant you focus, so ours fades then.
                    InputCursor(color: settings.actionStyle.color, height: size + 2)
                        .opacity(text.isEmpty && !focused ? 1 : 0)
                        .padding(.top, 2)
                    messageField
                }
                // Standby → active: on focus the composing area grows to hold a
                // comfortable five-plus lines and rises up to cover the terminal's own
                // input line beneath; longer input keeps growing and then scrolls.
                .frame(minHeight: expanded ? expandedInputHeight : nil, alignment: .top)
                // Drop the resting caret + first text line onto the send button's
                // centre so they read as one row; extra lines grow downward. (req 3)
                .padding(.top, firstLineInset)

                VStack(spacing: 8) {
                    sendButton
                    if session.tuiActive { thanksButton }
                }
            }

            // Control strip: the action pills (permissions · effort · skills ·
            // commands) and the chat/flow toggle on the left; the input controls
            // (return-to-send, attach, dictation, release-to-send) on the right.
            HStack(spacing: 10) {
                ChatToolbar(session: session, draft: $text, flowMode: $flowMode,
                            flowStore: flowStore, focus: { focused = true })
                    .tourTarget(.skills)
                inputControls
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(maxHeight: flowMode ? .infinity : nil, alignment: .bottom)
        // Top inset matches the horizontal inset so the send button nestles into the
        // rounded corner with equal margin from the top and right edges; the bottom
        // pills keep their tighter 9pt footing. (req 3)
        .padding(.horizontal, 14).padding(.top, 14).padding(.bottom, 9)
        // The whole card is the hit area: click anywhere in the open space —
        // padding included — to focus and expand. contentShape makes the empty
        // regions tappable; the buttons, toolbar and field keep priority and
        // handle their own taps, so this only fires on the otherwise-dead space.
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(inputFill.opacity(settings.chatInputOpacity))
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(focused ? settings.actionStyle.color.opacity(0.7) : Color(theme.border).opacity(0.7), lineWidth: 1))
                // The signature lifted input field. It reads as the primary way
                // in, so it keeps its full weight in the slim form too — docked
                // under the terminal it has to hold its own against whatever the
                // agent draws in the grid above it. The lift is cast in a tint of the
                // app's one highlight (the action colour) rather than flat black, so
                // the field glows in its own accent. (req: coloured shadow)
                .shadow(color: settings.actionStyle.color.opacity(focused ? 0.38 : 0.26), radius: focused ? 14 : 10, y: 3)
        )
        .animation(LeafPaneView.modeAnim, value: expanded)
        .tourTarget(.chatInput)
        // The input owns dictation + flow-reload lifecycle in every form it takes
        // (docked and the floating solo form), so the handlers live here rather
        // than on the docked container — the floating input is now the resting
        // form and must drive these too.
        .onAppear { installDictationKey() }
        .onChange(of: session.botWorking) { _, working in
            guard !working else { return }
            // The review turn has ended — adopt the agent's `review` from disk.
            if reviewingFlow { reviewingFlow = false; flowStore.reloadReview() }
            // The run turn has ended — adopt the agent's `run` checkpoint from disk so
            // the editor shows progress and can offer Resume if it stopped partway.
            if runningFlow { runningFlow = false; flowStore.reloadRun() }
            // The improve turn has ended — adopt the agent's rewritten flow + refreshed
            // review, then reopen the editor so the improvements are right there.
            if improvingFlow {
                improvingFlow = false
                flowStore.reloadImproved()
                withAnimation(LeafPaneView.modeAnim) { flowMode = true }
            }
        }
        .onDisappear { removeDictationKey(); flowStore.flushSave() }
        // Menu: Terminal ▸ Focus Message Input (⌘I). Only the focused pane's
        // input answers, so the caret lands in exactly one place.
        .onChange(of: workspace.focusInputRequest) {
            if session.id == workspace.focusedSessionID { focused = true }
        }
    }

    /// The message field itself — grows with what you type up to ~14 lines, then
    /// scrolls its own content so nothing is clipped out of reach. Placeholder is
    /// drawn ourselves (a dimmed copy of the input colour) — SwiftUI's default
    /// prompt renders in an unreadable system grey on the light chat fill.
    private var messageField: some View {
        TextField("", text: $text, axis: .vertical)
            .textFieldStyle(.plain)
            .font(chatStyle.font(size))
            .foregroundStyle(chatTextColor)
            .lineSpacing(CGFloat(settings.chatInputLineSpacing))
            .lineLimit(1...14)
            // Fill the row's width so long lines wrap (and reflow as the pane
            // narrows) instead of stretching the field past the card edge.
            .frame(maxWidth: .infinity, alignment: .leading)
            .focused($focused)
            // Modifier-aware Return: `.onSubmit` can't tell Shift+Return from
            // plain Return, so it used to send on both. With return-to-send on,
            // plain Return sends and Shift+Return inserts a newline (inverted when
            // off); ⌘↩ always sends via the button's shortcut. Returning
            // `.ignored` lets the vertical field insert the line break natively.
            .onKeyPress { press in
                guard press.key == .return else { return .ignored }
                if press.modifiers.contains(.command) { return .ignored }
                let shift = press.modifiers.contains(.shift)
                let wantsNewline = settings.returnToSend ? shift : !shift
                if wantsNewline {
                    // Insert the line break ourselves: a vertical TextField won't
                    // newline just because we return `.ignored` (the key falls
                    // through to a selection command instead), so append it
                    // explicitly and consume the event.
                    text += "\n"
                    return .handled
                }
                onReturn()
                return .handled
            }
            .overlay(alignment: .topLeading) {
                if let ph = inputPlaceholder, text.isEmpty {
                    Text(ph)
                        .font(chatStyle.font(size))
                        .foregroundStyle(chatTextColor.opacity(0.5))
                        .lineLimit(1).truncationMode(.tail)
                        .allowsHitTesting(false)
                }
            }
    }

    /// The primary action, stacked at the top-right of the lozenge. While the
    /// agent is working it becomes a Stop button (ESC); otherwise it sends (⌘↩),
    /// or in flow mode hands the whole flow to the agent.
    @ViewBuilder private var sendButton: some View {
        if session.botWorking && !flowMode {
            Button(action: { session.interrupt() }) {
                Image(systemName: "stop.fill")
                    .font(.system(size: size - 7, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(settings.actionStyle.fill))
            }
            .buttonStyle(.raisedIconHover)
            .keyboardShortcut(.cancelAction)   // Esc
            .help("Stop (Esc)")
        } else {
            Button(action: { flowMode ? sendFlow() : send() }) {
                Image(systemName: flowMode ? (flowIsResumable ? "play.fill" : "paperplane.fill") : "arrow.up")
                    .font(.system(size: size - 4, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(settings.actionStyle.fill))
            }
            .buttonStyle(.raisedIconHover)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(flowMode ? !canSendFlow : text.isEmpty)
            .help(flowMode ? (flowIsResumable ? "Resume this flow where it left off"
                                              : "Send this flow to the agent to carry out") : "Send")
        }
    }

    /// One-tap "thank you" — a filled circle beneath the send button, mirroring
    /// it. Only while Claude is running (it makes no sense at a plain shell); its
    /// wording tells Claude no task is attached and a single emoji back is all
    /// that's wanted, so a warm gesture doesn't cost a long reply (or many tokens).
    private var thanksButton: some View {
        Button(action: sendThanks) {
            Image(systemName: thanksHover ? "heart.fill" : "heart")
                .font(.system(size: size - 8, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Circle().fill(settings.actionStyle.fill))
        }
        .buttonStyle(.raisedIconHover)
        .onHover { thanksHover = $0 }
        .help(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              ? "Say thanks — Claude replies with just an emoji, no long response"
              : "Send your message with a ❤️ on the end")
    }

    /// The input controls sat at the right of the bottom control strip:
    /// return-to-send toggle, attachment, press-and-hold dictation, and the
    /// release-to-send toggle. Each is pill-height so it lines up with the action
    /// pills across the strip. (The "thanks" heart now lives with the send button.)
    private var inputControls: some View {
        HStack(spacing: 12) {
            Button(action: { settings.returnToSend.toggle() }) {
                ZStack {
                    Image(systemName: "return")
                        .font(.system(size: 12, weight: .medium))
                    if !settings.returnToSend {
                        Capsule().fill(Color(theme.secondaryForeground))
                            .frame(width: 1.5, height: 17)
                            .rotationEffect(.degrees(45))
                    }
                }
                // On = the action colour (the app's one highlight), off = text
                // colour; the theme accent used to leave a stray blue among the
                // input's red controls.
                .foregroundStyle(settings.returnToSend ? settings.actionStyle.color
                                                       : Color(theme.secondaryForeground))
                .frame(width: 20, height: 22)
            }
            .buttonStyle(.iconHover(padding: 3))
            .help(settings.returnToSend ? "Return sends (click to use ⌘↩ instead)" : "Return inserts a newline; ⌘↩ sends")

            Button(action: attach) {
                Image(systemName: "paperclip").font(.system(size: 12))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .frame(width: 20, height: 22)
            }
            .buttonStyle(.iconHover(padding: 3))
            .help("Attach a file")

            // Press and hold to dictate (or hold Right Option ⌥).
            Image(systemName: speech.isRecording ? "mic.fill" : "mic")
                .font(.system(size: 12))
                .foregroundStyle(Color(speech.isRecording ? .red : theme.secondaryForeground))
                .scaleEffect(speech.isRecording ? 1.15 : 1)
                .frame(width: 20, height: 22)
                .contentShape(Rectangle().inset(by: -8))
                .onLongPressGesture(minimumDuration: 3600, maximumDistance: 10_000, perform: {},
                                    onPressingChanged: { pressing in
                                        if pressing { startDictation() } else { endDictation() }
                                    })
                .help(settings.voiceReleaseToSend
                      ? "Hold to speak — release to send (or hold Right Option ⌥)"
                      : "Press and hold to speak (or hold Right Option ⌥)")

            // Release-to-send toggle for dictation (mirrors the Return toggle).
            Button(action: { settings.voiceReleaseToSend.toggle() }) {
                ZStack {
                    Image(systemName: "arrow.up.message")
                        .font(.system(size: 12, weight: .medium))
                    if !settings.voiceReleaseToSend {
                        Capsule().fill(Color(theme.secondaryForeground))
                            .frame(width: 1.5, height: 17)
                            .rotationEffect(.degrees(45))
                    }
                }
                .foregroundStyle(settings.voiceReleaseToSend ? settings.actionStyle.color : Color(theme.secondaryForeground))
                .frame(width: 20, height: 22)
            }
            .buttonStyle(.iconHover(padding: 3))
            .help(settings.voiceReleaseToSend
                  ? "Release-to-send: on (releasing the mic sends the message)"
                  : "Release-to-send: off (dictation just fills the box)")

            if speech.isRecording {
                Text("Listening…").font(settings.ui(10)).foregroundStyle(.red)
            }
        }
    }

    /// A quick "thanks" you can send without typing.
    private static let thanksMessage =
        "❤️ Thanks — no task here, just appreciation. A single emoji back is perfect; no need to explain or do anything."

    private func sendThanks() {
        guard session.tuiActive else { return }
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Typing then tapping the heart used to fire the canned blurb and drop what
        // you'd written; now a non-empty field sends your message with a heart on
        // the end via the normal send path, and only an empty field sends the canned
        // appreciation. (req 8)
        if typed.isEmpty {
            session.submitInput(Self.thanksMessage)
        } else {
            text = typed + " ❤️"
            send()
        }
    }

    /// Tags for files dropped onto the pane (filename only, not the full path).
    private var attachmentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(session.pendingAttachments, id: \.self) { url in
                    HStack(spacing: 4) {
                        Image(systemName: isDirectory(url) ? "folder.fill" : "doc.fill")
                            .font(.system(size: 9))
                        Text(url.lastPathComponent)
                            .font(settings.ui(11, .medium))
                            .lineLimit(1)
                        Button(action: { session.pendingAttachments.removeAll { $0 == url } }) {
                            Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                        }.buttonStyle(.iconHover(padding: 2, radius: 4)).help("Remove")
                    }
                    .foregroundStyle(settings.actionStyle.color)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(settings.actionStyle.color.opacity(0.16)))
                    .overlay(Capsule().strokeBorder(settings.actionStyle.color.opacity(0.4), lineWidth: 1))
                }
            }
            .padding(.bottom, 1)
        }
    }

    private func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
    }

    private func startDictation() {
        guard !speech.isRecording else { return }
        micBase = text.isEmpty ? "" : text + " "
        speech.onUpdate = { t in self.text = self.micBase + t }
        speech.start()
    }

    /// Stop dictation; if release-to-send is on, send the captured text once the
    /// recognizer has flushed its final transcript.
    private func endDictation() {
        let wasRecording = speech.isRecording
        speech.stop()
        guard wasRecording, settings.voiceReleaseToSend else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { send() }
        }
    }

    private func attach() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        if panel.runModal() == .OK {
            for url in panel.urls where !session.pendingAttachments.contains(url) {
                session.pendingAttachments.append(url)
            }
        }
    }

    private func copyToPasteboard(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    /// Return key behaviour: if a single-select agent prompt is up and you
    /// haven't typed anything, answer the highlighted option; otherwise send the
    /// message (honouring the return-to-send setting).
    private func onReturn() {
        // In flow mode, Return hands the flow to the agent (honouring return-to-send),
        // so the note field doesn't swallow the primary action.
        if flowMode {
            if settings.returnToSend { sendFlow() }
            return
        }
        if let prompt = session.pendingPrompt, !prompt.isMultiSelect,
           text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let opt = prompt.options.first(where: { $0.number == selectedOption }) {
            session.answerPrompt(opt)
            return
        }
        if settings.returnToSend { send() }
    }

    private func send() {
        let msg = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Answering an agent prompt with a typed custom answer: deliver it verbatim,
        // with no effort keyword or attachment decoration that would corrupt it.
        // (Pair with clicking the prompt's "write your own" option first, which
        // opens the agent's text field.)
        if session.pendingPrompt != nil, !msg.isEmpty {
            session.submitInput(msg)
            text = ""
            return
        }
        // Attached files (shown as tags) are sent as their paths so the agent can act on them.
        let attachPaths = session.pendingAttachments
            .map { $0.path.contains(" ") ? "\"\($0.path)\"" : $0.path }
            .joined(separator: " ")
        settings.hasSeenWelcome = true   // first message dismisses the welcome
        // Prepend the effort keyword ("think" / "ultrathink" …) to dial reasoning.
        let effort = session.effortKeyword
        let full = [effort, msg, attachPaths].filter { !$0.isEmpty }.joined(separator: " ")
        guard !msg.isEmpty || !attachPaths.isEmpty else { return }
        session.submitInput(full)
        text = ""
        session.pendingAttachments = []
    }
}

/// A little critter that runs on the spot while the ground scrolls beneath it —
/// a charmingly alive "agent is working" indicator. One critter per task: the
/// animal is chosen from a stable `seed` so it doesn't change mid-turn. When the
/// critter has a run-cycle (multiple frames) those are played as a sprite loop;
/// otherwise a single still image is shown with a gentle body bob. `tint` only
/// colours the neutral ground, dust and contact shadow around it.
struct WorkingCritter: View {
    var tint: Color
    /// A per-task value; the same seed always yields the same critter, so it
    /// stays put for the whole working task and varies turn to turn.
    var seed: Int = 0
    var size: CGFloat = 28
    /// Seconds per run-cycle frame.
    private let frameStep: TimeInterval = 0.11
    @State private var roll = false
    @State private var dust = false
    @State private var bob = false

    private var frames: [NSImage] { Critters.frames(Critters.name(forSeed: seed)) }
    private var trackW: CGFloat { size * 2.6 }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Scrolling ground: two dashed strips chasing each other so the motion
            // loops seamlessly and the critter reads as running forward.
            ZStack {
                ground.offset(x: roll ? -trackW : 0)
                ground.offset(x: roll ? 0 : trackW)
            }
            .frame(width: trackW, height: 2, alignment: .leading)

            // Little dust puffs kicked up behind the critter on each stride.
            HStack(spacing: 2) {
                Circle().fill(tint.opacity(dust ? 0 : 0.28)).frame(width: 3, height: 3)
                Circle().fill(tint.opacity(dust ? 0 : 0.18)).frame(width: 2, height: 2)
            }
            .offset(x: -size * 0.55, y: dust ? -size * 0.22 : -2)
            .padding(.bottom, 3)

            ZStack {
                // A soft contact shadow beneath the critter.
                Ellipse()
                    .fill(tint.opacity(0.16))
                    .frame(width: size * 0.5, height: size * 0.12)
                    .offset(y: size * 0.04)

                critter
                    .offset(y: bob ? -size * 0.1 : 0)   // gentle body bob for life
            }
            .padding(.bottom, 3)
        }
        .frame(width: trackW, height: size + 10)
        .clipped()
        .onAppear {
            withAnimation(.linear(duration: 0.6).repeatForever(autoreverses: false)) { roll = true }
            withAnimation(.easeOut(duration: 0.5).repeatForever(autoreverses: false)) { dust = true }
            withAnimation(.easeInOut(duration: 0.22).repeatForever(autoreverses: true)) { bob = true }
        }
    }

    /// The animal itself — a sprite-cycled run loop when frames are bundled, a
    /// single still otherwise, or a plain SF Symbol hare as a last resort.
    @ViewBuilder private var critter: some View {
        let fr = frames
        if fr.count > 1 {
            TimelineView(.periodic(from: .now, by: frameStep)) { context in
                let step = context.date.timeIntervalSinceReferenceDate / frameStep
                let idx = Int(step.truncatingRemainder(dividingBy: Double(fr.count)))
                Image(nsImage: fr[max(0, min(fr.count - 1, idx))])
                    .resizable().interpolation(.high).scaledToFit()
                    .frame(width: size, height: size)
            }
        } else if let one = fr.first {
            Image(nsImage: one)
                .resizable().interpolation(.high).scaledToFit()
                .frame(width: size, height: size)
        } else {
            Image(systemName: "hare.fill")
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(tint)
        }
    }

    /// One strip of ground the width of the track — a row of little dashes.
    private var ground: some View {
        HStack(spacing: 5) {
            ForEach(0..<7, id: \.self) { _ in
                Capsule().fill(tint.opacity(0.35)).frame(width: 6, height: 2)
            }
        }
        .frame(width: trackW, alignment: .leading)
    }
}

/// A lightweight markdown renderer for the agent's prose. Handles fenced code
/// blocks (monospace), headings, bullet lists, and inline bold/italic/code.
struct MarkdownText: View {
    let text: String
    var baseSize: CGFloat = 13
    /// Which panel's typography to render in. Defaults to the chat (this view's
    /// original home); the document viewer passes `.doc` so its preview and its
    /// raw editor share one font and size.
    var panel: PanelKind = .chat
    @ObservedObject private var settings = AppSettings.shared
    /// The parsed blocks, with inline markdown already resolved per line. The
    /// parse depends only on `text` — never on appearance settings — so it runs
    /// once per text change, not on every body evaluation (this view observes
    /// AppSettings, and an appearance tick used to re-split and re-parse the
    /// whole document, building an AttributedString per line each time).
    @State private var parsed: [Block]
    private var theme: Theme { settings.theme }
    /// The per-panel appearance (typography + colour) this render uses.
    private var style: PanelStyle { settings.panelStyle(panel, base: baseSize, background: theme.background) }
    private var resolvedTextColor: Color { style.textColor }
    // The doc panel's raw editor uses `style.lineSpacing` alone, so its preview
    // must too — otherwise line spacing jumps when toggling edit/preview. Chat
    // keeps its own extra per-line spacing.
    private var ls: CGFloat { panel == .doc ? style.lineSpacing : CGFloat(settings.chatLineSpacing) + style.lineSpacing }

    init(text: String, baseSize: CGFloat = 13, panel: PanelKind = .chat) {
        self.text = text
        self.baseSize = baseSize
        self.panel = panel
        self._parsed = State(initialValue: Self.parse(text))
    }

    /// A parsed block. Identity is positional (its index), never the content —
    /// content-keyed ids collided whenever two paragraphs had identical text.
    private struct Block: Identifiable {
        enum Content {
            case prose([Line])
            case code(String)
        }
        let id: Int
        let content: Content
    }

    /// A prose line with its inline markdown already resolved (headings,
    /// bullets, and blanks pre-classified in `parse`).
    private struct Line: Identifiable {
        enum Content {
            case blank
            case heading(Int, AttributedString)
            case bullet(AttributedString)
            case plain(AttributedString)
        }
        let id: Int
        let content: Content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: max(4, AppSettings.shared.chatLineSpacing + 4)) {
            ForEach(parsed) { block in
                switch block.content {
                case .prose(let lines):
                    proseView(lines)
                case .code(let s):
                    Text(s)
                        .font(settings.mono(baseSize - 2))
                        .foregroundStyle(resolvedTextColor)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 7).fill(Color(theme.background).opacity(0.6)))
                        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color(theme.border)))
                }
            }
        }
        .onChange(of: text) { _, new in parsed = Self.parse(new) }
    }

    /// Split the document into blocks and resolve every line's inline markdown.
    private static func parse(_ text: String) -> [Block] {
        var result: [Block] = []
        let parts = text.components(separatedBy: "```")
        for (i, part) in parts.enumerated() {
            if i % 2 == 1 {
                var code = part
                if let nl = code.firstIndex(of: "\n") { code = String(code[code.index(after: nl)...]) }
                let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { result.append(Block(id: result.count, content: .code(trimmed))) }
            } else {
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { result.append(Block(id: result.count, content: .prose(parseLines(trimmed)))) }
            }
        }
        return result.isEmpty ? [Block(id: 0, content: .prose(parseLines(text)))] : result
    }

    private static func parseLines(_ s: String) -> [Line] {
        s.components(separatedBy: "\n").enumerated().map { i, raw in
            let t = raw.trimmingCharacters(in: .whitespaces)
            let content: Line.Content
            if t.isEmpty {
                content = .blank
            } else if let level = headingLevel(t) {
                content = .heading(level, inline(String(t.drop(while: { $0 == "#" || $0 == " " }))))
            } else if t.hasPrefix("- ") || t.hasPrefix("* ") {
                content = .bullet(inline(String(t.dropFirst(2))))
            } else {
                content = .plain(inline(t))
            }
            return Line(id: i, content: content)
        }
    }

    @ViewBuilder
    private func proseView(_ lines: [Line]) -> some View {
        VStack(alignment: .leading, spacing: max(2, ls)) {
            ForEach(lines) { line in
                lineView(line)
            }
        }
    }

    @ViewBuilder
    private func lineView(_ line: Line) -> some View {
        switch line.content {
        case .blank:
            Spacer().frame(height: 2)
        case .heading(let level, let attr):
            Text(attr)
                .font(style.font(baseSize + (level == 1 ? 4 : (level == 2 ? 2 : 1)), .semibold))
                .tracking(style.tracking)
                .foregroundStyle(resolvedTextColor)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        case .bullet(let attr):
            HStack(alignment: .top, spacing: 7) {
                Text("•").foregroundStyle(Color(theme.secondaryForeground))
                Text(attr)
                    .font(style.font(baseSize))
                    .tracking(style.tracking)
                    .lineSpacing(ls)
                    .foregroundStyle(resolvedTextColor)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .plain(let attr):
            Text(attr)
                .font(style.font(baseSize))
                .tracking(style.tracking)
                .lineSpacing(ls)
                .foregroundStyle(resolvedTextColor)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private static func headingLevel(_ t: String) -> Int? {
        guard t.hasPrefix("#") else { return nil }
        let hashes = t.prefix(while: { $0 == "#" }).count
        return (hashes >= 1 && hashes <= 6 && t.dropFirst(hashes).hasPrefix(" ")) ? hashes : nil
    }

    private static func inline(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }
}
