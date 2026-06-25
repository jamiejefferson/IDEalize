import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// The unified Claude chat box: your latest question (condensed) on top, a
/// gentle divider, then Claude's answer, then the input — all in one card that
/// floats over a blurred view of the terminal "thinking" behind it.
struct QAChatBox: View {
    @ObservedObject var session: TerminalSession
    @ObservedObject var workspace: Workspace
    /// Slim form (just the input) used in plain-shell mode before a chat exists.
    var collapsed: Bool = false
    /// Docked form: fills the bottom of a VSplitView (terminal on top). The split
    /// divider handles resizing, so there's no in-view resize handle.
    var docked: Bool = false
    @ObservedObject private var settings = AppSettings.shared
    @ObservedObject private var speech = SpeechDictation.shared
    @State private var text = ""
    @State private var micBase = ""
    @State private var keyMonitor: Any?
    /// The highlighted option in a single-select Claude prompt. Hover moves it,
    /// click answers immediately, Return answers the highlighted one.
    @State private var selectedOption = 1
    /// When true, the chat region shows the Flow editor instead of the answer.
    @State private var flowMode = false
    /// The flow being sketched — a single global document (like a skill), the same
    /// in every session and tab. Persisted to the app's global flow path.
    @StateObject private var flowStore = FlowStore()
    /// True from sending a flow to Claude until its turn ends — drives the editor's
    /// spinner and triggers the review reload when Claude finishes.
    @State private var reviewingFlow = false
    /// True while Claude is carrying out the flow (the verdict-gated Run).
    @State private var runningFlow = false
    @FocusState private var focused: Bool

    private var theme: Theme { settings.theme }
    private var size: CGFloat { settings.chatFontSize }
    private var chatStyle: PanelStyle { settings.panelStyle(.chat, base: settings.chatFontSize, background: theme.background) }
    /// Chat text colour: the per-panel override if set, else the chat setting.
    private var chatTextColor: Color {
        if let c = NSColor(hex: settings.appearance(.chat).textColorHex) { return Color(c) }
        return Color(settings.chatTextColor)
    }
    private var working: Bool { session.botWorking }

    var body: some View {
        if collapsed {
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
        .onAppear { installDictationKey() }
        .onChange(of: session.botWorking) { _, working in
            guard !working else { return }
            // The review turn has ended — adopt Claude's `review` from disk.
            if reviewingFlow { reviewingFlow = false; flowStore.reloadReview() }
            // The run turn has ended — adopt Claude's `run` checkpoint from disk so
            // the editor shows progress and can offer Resume if it stopped partway.
            if runningFlow { runningFlow = false; flowStore.reloadRun() }
        }
        .onDisappear { removeDictationKey(); flowStore.flushSave() }
    }

    /// Chat face: the condensed question (if any) on top, then Claude's answer
    /// (or the welcome / working state) scrolling beneath.
    @ViewBuilder private var conversationPane: some View {
        if settings.hasSeenWelcome, let q = session.displayedQuestion, !q.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                questionRow(q)
                if session.exchanges.count > 1 { historyNav }
            }
            .padding(.horizontal, 18).padding(.top, 12)
            Rectangle().fill(Color(theme.border).opacity(0.6)).frame(height: 1)
                .padding(.vertical, 10).padding(.horizontal, 18)
        } else {
            Color.clear.frame(height: 12)
        }
        Group {
            if !settings.hasSeenWelcome {
                // First-run welcome takes priority over everything else.
                ScrollView {
                    welcomeCard
                        .padding(.horizontal, settings.chatMargin).padding(.bottom, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if !session.isBrowsingHistory && session.pendingPrompt == nil && working {
                // Centre the Idealizing animation in the pane while working.
                workingView.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ScrollView {
                    answerArea
                        .padding(.horizontal, settings.chatMargin)
                        .padding(.bottom, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Send the sketched flow to Claude for review. The pre-flight already gated
    /// the button, so by here the structure is sound. We flush the file (Claude
    /// reads it), close the editor so the work is visible, and run `/flow-review`;
    /// `onChange(botWorking)` reloads the verdict when the turn ends.
    private func reviewFlow() {
        flowStore.flushSave()
        reviewingFlow = true
        withAnimation(LeafPaneView.modeAnim) { flowMode = false }
        session.runCommand("/flow-review")
    }

    /// True when the working flow is worth handing to Claude: it has steps and no
    /// blocking structural errors. Drives the input's send arrow in flow mode.
    private var canSendFlow: Bool {
        !flowStore.flow.flow.blocks.isEmpty &&
        !flowStore.flow.flow.validate().contains { $0.severity == .error }
    }

    /// The primary "send to Claude" path for a flow: hand it over to be carried
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
            return Color(c.blended(withFraction: 0.12, of: theme.foreground) ?? c)
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
            Text("This is your AI workspace — no coding needed. Just tell Claude what you'd like to do, in plain English, and it gets to work.")
                .font(chatStyle.font(size)).foregroundStyle(chatTextColor)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 9) {
                welcomeBullet("sidebar.left", "On the left — your sessions and files.")
                welcomeBullet("bubble.left.and.bubble.right.fill", "Right here — chat with Claude, your assistant.")
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

    private func questionRow(_ q: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 20)
                .padding(.top, (size - 2) * 0.16)
            Text(q)
                .font(chatStyle.font(size - 2, .medium))
                .tracking(chatStyle.tracking)
                .foregroundStyle(chatStyle.secondaryTextColor)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Back/forward pager for stepping through past Q&A exchanges. Sits beside the
    /// condensed question; the forward edge returns to live.
    private var historyNav: some View {
        HStack(spacing: 9) {
            Button(action: { session.historyBack() }) {
                Image(systemName: "chevron.left")
                    .font(.system(size: size - 3, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground).opacity(session.canGoBack ? 1 : 0.3))
            }
            .buttonStyle(.plain).disabled(!session.canGoBack).help("Previous message")

            if let pos = session.historyPosition {
                Text(pos)
                    .font(settings.ui(size - 4, .medium)).monospacedDigit()
                    .foregroundStyle(chatStyle.secondaryTextColor)
            }

            Button(action: { session.historyForward() }) {
                Image(systemName: "chevron.right")
                    .font(.system(size: size - 3, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground).opacity(session.canGoForward ? 1 : 0.3))
            }
            .buttonStyle(.plain).disabled(!session.canGoForward).help("Next message")
        }
        .padding(.top, (size - 2) * 0.16)
        .fixedSize()
    }

    @ViewBuilder private var answerArea: some View {
        if !session.isBrowsingHistory, let prompt = session.pendingPrompt {
            promptView(prompt)
        } else if !session.isBrowsingHistory && working {
            workingView
        } else if !session.isBrowsingHistory && session.liveInteractivePrompt {
            // The live terminal is on a prompt the chat can't render. Reflect
            // that instead of the previous (now stale) transcript answer.
            terminalAttentionView
        } else if let a = session.displayedAnswer, !a.isEmpty {
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
                    }.buttonStyle(.plain).help("Copy response")
                }
            }
        } else {
            EmptyView()
        }
    }

    /// Claude is asking a question — show it with answer buttons.
    private func promptView(_ prompt: ClaudePrompt) -> some View {
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

    /// A tappable checkbox option (multi-select). Tapping toggles it in Claude;
    /// the screen re-parses and the tick updates.
    private func checkboxRow(_ opt: ClaudePrompt.Option) -> some View {
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
    private func actionRow(_ opt: ClaudePrompt.Option, selected: Bool) -> some View {
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

    /// Working state: the big, centred, watermarked "Idealizing" word with
    /// Claude's live status (and tip) centred underneath.
    private var workingView: some View {
        VStack(spacing: 12) {
            IdealizingAnimation(size: 34)
                .opacity(0.5)   // slightly watermarked
            if let status = session.workingStatus, !status.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "hourglass").font(.system(size: size - 5))
                    Text(status).font(settings.ui(size - 3)).monospacedDigit()
                }
                .foregroundStyle(Color(theme.secondaryForeground))
            }
            if let tip = session.workingTip, !tip.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "lightbulb").font(.system(size: size - 5))
                    Text(tip).font(settings.ui(size - 4))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Color(theme.secondaryForeground))
                .frame(maxWidth: 520)
                .padding(.horizontal, 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 20)
    }

    /// Shown when Claude is sitting on an interactive prompt the chat can't
    /// render (an arrow-key menu, a trust dialog). Keeps the chat honest about
    /// the live state and sends you to the terminal to answer.
    private var terminalAttentionView: some View {
        VStack(spacing: 12) {
            Image(systemName: "keyboard.badge.ellipsis")
                .font(.system(size: 30))
                .foregroundStyle(Color(theme.accent)).opacity(0.85)
            Text("Claude is waiting for you in the terminal")
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

    /// A delicate lozenge around the input (grows as you type) plus a mini-menu.
    private var inputLozenge: some View {
        VStack(alignment: .leading, spacing: 7) {
            // Contextual toolbar pinned at the top of the container: the chat/flow
            // toggle, then either the chat actions (model · effort · skills ·
            // commands) or, in flow mode, the flow library — swapped in place.
            ChatToolbar(session: session, draft: $text, flowMode: $flowMode,
                        flowStore: flowStore, focus: { focused = true })

            // Flow mode: the builder lives inside this same container, which has
            // grown upward to hold it. It scrolls; the note field stays pinned at
            // the bottom so you can add an instruction to send with the flow.
            if flowMode {
                Rectangle().fill(Color(theme.border).opacity(0.45)).frame(height: 1)
                    .padding(.vertical, 1)
                ScrollView {
                    FlowEditorView(flow: $flowStore.flow,
                                   onReview: reviewFlow, reviewing: reviewingFlow)
                        .padding(.vertical, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                Rectangle().fill(Color(theme.border).opacity(0.45)).frame(height: 1)
                    .padding(.vertical, 1)
            }
            if !session.pendingAttachments.isEmpty {
                attachmentChips
            }
            HStack(alignment: .bottom, spacing: 10) {
                Image(systemName: "chevron.right")
                    .font(.system(size: size - 3, weight: .bold))
                    .foregroundStyle(settings.actionStyle.color)
                    .padding(.bottom, 3)
                // Grows with what you type up to ~14 lines, then scrolls its own
                // content internally so nothing is clipped out of reach (the
                // vertical TextField scrolls past its line-limit natively). Its
                // line-spacing is independent of the chat answer/modal.
                TextField(flowMode ? "Add a note for Claude (optional)…" : "", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(chatStyle.font(size))
                    .foregroundStyle(chatTextColor)
                    .lineSpacing(CGFloat(settings.chatInputLineSpacing))
                    .lineLimit(1...14)
                    .focused($focused)
                    .onSubmit { onReturn() }
                // Always-available send shortcut (⌘↩), plus a visible button. In
                // flow mode the arrow hands the whole flow to Claude rather than
                // the typed text — the single "send this flow" action.
                Button(action: { flowMode ? sendFlow() : send() }) {
                    Image(systemName: flowMode ? (flowIsResumable ? "play.fill" : "paperplane.fill") : "arrow.up")
                        .font(.system(size: size - 4, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(settings.actionStyle.fill))
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(flowMode ? !canSendFlow : text.isEmpty)
                .help(flowMode ? (flowIsResumable ? "Resume this flow where it left off"
                                                  : "Send this flow to Claude to carry out") : "Send")
            }
            miniMenu
        }
        .frame(maxHeight: flowMode ? .infinity : nil, alignment: .bottom)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(inputFill.opacity(settings.chatInputOpacity))
                .overlay(RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(focused ? settings.actionStyle.color.opacity(0.7) : Color(theme.border).opacity(0.7), lineWidth: 1))
                // The signature lifted input field.
                .shadow(color: .black.opacity(focused ? 0.32 : 0.22), radius: focused ? 14 : 10, y: 3)
        )
    }

    /// Return-to-send toggle, attachment, and press-and-hold dictation.
    private var miniMenu: some View {
        HStack(spacing: 16) {
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
                .foregroundStyle(Color(settings.returnToSend ? theme.accent : theme.secondaryForeground))
                .frame(width: 18, height: 16)
            }
            .buttonStyle(.plain)
            .help(settings.returnToSend ? "Return sends (click to use ⌘↩ instead)" : "Return inserts a newline; ⌘↩ sends")

            Button(action: attach) {
                Image(systemName: "paperclip").font(.system(size: 12))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .buttonStyle(.plain)
            .help("Attach a file")

            // Press and hold to dictate (or hold Right Option ⌥).
            Image(systemName: speech.isRecording ? "mic.fill" : "mic")
                .font(.system(size: 12))
                .foregroundStyle(Color(speech.isRecording ? .red : theme.secondaryForeground))
                .scaleEffect(speech.isRecording ? 1.15 : 1)
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
                .frame(width: 18, height: 16)
            }
            .buttonStyle(.plain)
            .help(settings.voiceReleaseToSend
                  ? "Release-to-send: on (releasing the mic sends the message)"
                  : "Release-to-send: off (dictation just fills the box)")

            if speech.isRecording {
                Text("Listening…").font(settings.ui(10)).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
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
                        }.buttonStyle(.plain)
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

    /// Return key behaviour: if a single-select Claude prompt is up and you
    /// haven't typed anything, answer the highlighted option; otherwise send the
    /// message (honouring the return-to-send setting).
    private func onReturn() {
        // In flow mode, Return hands the flow to Claude (honouring return-to-send),
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
        // Attached files (shown as tags) are sent as their paths so Claude can act on them.
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

/// A lightweight markdown renderer for Claude's prose. Handles fenced code
/// blocks (monospace), headings, bullet lists, and inline bold/italic/code.
struct MarkdownText: View {
    let text: String
    var baseSize: CGFloat = 13
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }
    /// The per-panel Chat appearance (typography + colour).
    private var style: PanelStyle { settings.panelStyle(.chat, base: baseSize, background: theme.background) }
    private var resolvedTextColor: Color {
        if let c = NSColor(hex: style.appearance.textColorHex) { return Color(c) }
        return Color(settings.chatTextColor)
    }
    private var ls: CGFloat { CGFloat(settings.chatLineSpacing) + style.lineSpacing }

    private enum Block: Identifiable {
        case prose(String)
        case code(String)
        var id: String {
            switch self {
            case .prose(let s): return "p" + s
            case .code(let s): return "c" + s
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: max(4, AppSettings.shared.chatLineSpacing + 4)) {
            ForEach(blocks) { block in
                switch block {
                case .prose(let s):
                    proseView(s)
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
    }

    private var blocks: [Block] {
        var result: [Block] = []
        let parts = text.components(separatedBy: "```")
        for (i, part) in parts.enumerated() {
            if i % 2 == 1 {
                var code = part
                if let nl = code.firstIndex(of: "\n") { code = String(code[code.index(after: nl)...]) }
                let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { result.append(.code(trimmed)) }
            } else {
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { result.append(.prose(trimmed)) }
            }
        }
        return result.isEmpty ? [.prose(text)] : result
    }

    @ViewBuilder
    private func proseView(_ s: String) -> some View {
        VStack(alignment: .leading, spacing: max(2, ls)) {
            ForEach(Array(s.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                lineView(line)
            }
        }
    }

    @ViewBuilder
    private func lineView(_ line: String) -> some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.isEmpty {
            Spacer().frame(height: 2)
        } else if let level = headingLevel(t) {
            Text(inline(String(t.drop(while: { $0 == "#" || $0 == " " }))))
                .font(style.font(baseSize + (level == 1 ? 4 : (level == 2 ? 2 : 1)), .semibold))
                .tracking(style.tracking)
                .foregroundStyle(resolvedTextColor)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } else if t.hasPrefix("- ") || t.hasPrefix("* ") {
            HStack(alignment: .top, spacing: 7) {
                Text("•").foregroundStyle(Color(theme.secondaryForeground))
                Text(inline(String(t.dropFirst(2))))
                    .font(style.font(baseSize))
                    .tracking(style.tracking)
                    .lineSpacing(ls)
                    .foregroundStyle(resolvedTextColor)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            Text(inline(t))
                .font(style.font(baseSize))
                .tracking(style.tracking)
                .lineSpacing(ls)
                .foregroundStyle(resolvedTextColor)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func headingLevel(_ t: String) -> Int? {
        guard t.hasPrefix("#") else { return nil }
        let hashes = t.prefix(while: { $0 == "#" }).count
        return (hashes >= 1 && hashes <= 6 && t.dropFirst(hashes).hasPrefix(" ")) ? hashes : nil
    }

    private func inline(_ s: String) -> AttributedString {
        (try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }
}
