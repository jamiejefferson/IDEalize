import SwiftUI
import AppKit
import SwiftTerm
import IDEalizeCore

/// High-level status of the agent (Claude) in a session, surfaced as a tag on
/// its tab so you can tell at a glance which sessions need you.
/// - `working`: Claude is actively generating.
/// - `waiting`: Claude asked a question and is blocked on your answer — the one
///   that needs attention.
/// - `complete`: Claude finished its turn with nothing outstanding.
/// - `idle`: no agent activity (plain shell, or the status has been seen).
enum AgentStatus { case idle, working, waiting, complete }

/// One terminal: owns a `LocalProcessTerminalView`, tracks its state, holds an
/// inter-agent mailbox, and exposes observable properties the UI binds to.
final class TerminalSession: NSObject, ObservableObject, Identifiable {
    let id: String
    let terminalView: IDEalizeTerminalView

    // Observable state surfaced in tabs / status.
    @Published var title: String = "shell"
    @Published var projectPath: String?
    @Published var processName: String = "zsh"
    @Published var isShellForeground: Bool = true
    @Published var isRunning: Bool = true
    @Published var customStatus: String?
    @Published var unreadCount: Int = 0
    @Published var hasActivity: Bool = false   // output since last focused
    /// A full-screen TUI (Claude Code, vim, top, less…) is currently drawing on
    /// the alternate screen. Drives giving the whole pane to the terminal.
    @Published var inAltScreen: Bool = false
    /// Claude's latest completed message (markdown), read from Claude Code's own
    /// transcript while a Claude session runs in this terminal. Rendered in the
    /// chat panel.
    @Published var assistantMessage: String?
    /// The latest user prompt (shown condensed at the top of the chat panel).
    @Published var userQuestion: String?
    /// Claude is actively generating a reply (drives the tab working spinner).
    @Published var botWorking: Bool = false
    /// A confirmation/choice prompt Claude is showing — answered from the chat UI.
    @Published var pendingPrompt: ClaudePrompt?
    /// An interactive prompt is live on the terminal that we could NOT parse into
    /// answer buttons (an arrow-key menu, a trust dialog, a free-form confirm).
    /// These never reach Claude's transcript, so without this flag the chat would
    /// keep showing the previous, now-stale answer. When set, the chat shows a
    /// "answer in the terminal" affordance instead of that stale message.
    @Published var liveInteractivePrompt: Bool = false
    /// High-level agent status shown as a tab tag (see `AgentStatus`). Driven by
    /// `detectPrompt`; cleared back to `.idle` from `.complete` once the tab is
    /// focused (acknowledged).
    @Published var agentStatus: AgentStatus = .idle
    /// The last completed reply the user has already looked at (set on focus).
    /// A finished, non-question reply shows `Complete` until it matches this —
    /// then it falls back to idle. Keyed to the message text so it survives the
    /// status being re-derived from scratch each poll.
    private var acknowledgedMessage: String?
    /// Claude's live status line while working (e.g. "17m 43s · ↑ 31.9k tokens").
    @Published var workingStatus: String?
    /// Claude's current tip (e.g. "Use /btw to ask a quick side question…").
    @Published var workingTip: String?
    /// Per-panel chat modal sizing (each terminal keeps its own).
    /// Manual height as a fraction of the pane (0 = auto / content-sized).
    @Published var chatHeightFraction: Double = 0
    /// Collapsed to just the chrome (handle + title + buttons + input).
    @Published var chatMinimised: Bool = false
    /// Vertical position of the modal above the pane bottom (points; 0 = bottom).
    @Published var chatOffset: CGFloat = 0
    /// Files dragged onto the pane, shown as tags in the chat input.
    @Published var pendingAttachments: [URL] = []
    /// The pane's mode toggle. false = chat overlay (terminal blurred behind);
    /// true = the full, interactive terminal.
    @Published var revealTerminal: Bool = false
    /// The Claude model label shown in the input toolbar (display only).
    @Published var modelLabel: String = "Auto"
    /// Thinking-effort label shown in the toolbar.
    @Published var effortLabel: String = "Standard"
    /// The thinking keyword prepended to messages ("", "think", "think hard",
    /// "ultrathink") to dial Claude's reasoning effort up.
    var effortKeyword: String = ""

    /// Switch the running Claude's model via its `/model` command.
    func setModel(_ id: String, _ label: String) {
        modelLabel = label
        guard tuiActive else { return }   // only a running Claude can switch
        sendLineToTUI("/model \(id)")
    }

    /// Send a line of input to the live TUI (Claude Code) as the pasted text
    /// followed by a SEPARATE Return a short beat later. Claude's TUI wraps
    /// pasted input in bracketed-paste markers (ESC[200~ … ESC[201~), so a
    /// trailing `\r` in the same write lands inside the paste as a literal
    /// newline rather than a discrete Enter keypress and never submits. Writing
    /// the Return on its own, after the paste has flushed, makes it register as
    /// a real Return so the message actually sends.
    private func sendLineToTUI(_ text: String) {
        terminalView.send(txt: text)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.09) { [weak self] in
            self?.terminalView.send(txt: "\r")   // 0x0D, discrete Enter
        }
    }

    func setEffort(_ keyword: String, _ label: String) {
        effortKeyword = keyword
        effortLabel = label
    }

    /// Run a slash command in the running Claude (or launch + run).
    func runCommand(_ slash: String) {
        submitInput(slash)
    }

    private var transcriptURL: URL?
    private var transcriptMTime: Date?

    // Blocks (Warp-style command tracking via shell integration).
    @Published var blocks: [CommandBlock] = []
    @Published var lastExitCode: Int32?
    /// Command currently running (if any).
    var runningCommand: String? { blocks.last(where: { $0.isRunning })?.command }
    /// A Claude Code session is the current foreground command. Reliable even
    /// when Claude doesn't use the alternate screen / reports an odd proc name.
    var isClaudeRunning: Bool {
        guard let cmd = runningCommand?.lowercased() else { return false }
        // Match a `claude` invocation anywhere in the (possibly compound)
        // command: bare, with args, after `&&`/`;`, or as a full path.
        return cmd.range(of: "(^|[ /&;])claude($| )", options: .regularExpression) != nil
    }
    /// True whenever a TUI (Claude or another full-screen program) owns the pane.
    var tuiActive: Bool { inAltScreen || isClaudeRunning }
    /// A command (or bot) is currently running in this terminal.
    var isRunningCommand: Bool { blocks.last?.isRunning == true }

    /// Inter-agent inbox. Drained by `idealize inbox`.
    private(set) var mailbox: [IPCMessage] = []

    /// Called when this session wants to be brought to the foreground.
    var onFocusRequested: ((String) -> Void)?
    /// Called when the user interacts with (clicks/types in) this terminal.
    var onUserFocused: ((String) -> Void)?

    private let settings: AppSettings
    private var statusTimer: Timer?
    private weak var workspace: Workspace?

    init(settings: AppSettings, workspace: Workspace, projectPath: String? = nil) {
        self.id = TerminalSession.makeID()
        self.settings = settings
        self.workspace = workspace
        self.projectPath = projectPath
        self.terminalView = IDEalizeTerminalView(frame: .init(x: 0, y: 0, width: 800, height: 480))
        super.init()

        terminalView.processDelegate = self
        terminalView.allowMouseReporting = true   // mouse support for TUIs
        terminalView.optionAsMetaKey = true
        terminalView.onShellEvent = { [weak self] event in self?.handle(event) }
        terminalView.onCommandFinished = { [weak self] code, bytes, alt in
            self?.finishCommand(exitCode: code, bytes: bytes, altScreen: alt)
        }
        terminalView.onAltScreenChanged = { [weak self] alt in
            guard let self else { return }
            self.inAltScreen = alt
            // Re-assert the configured terminal font/theme so the TUI renders in
            // the user's chosen typography (not a stale fallback).
            self.applyTheme(self.settings.theme, font: self.settings.resolvedFont())
        }
        applyTheme(settings.theme, font: settings.resolvedFont())
    }

    // MARK: - Shell events → blocks

    private func handle(_ event: ShellEvent) {
        switch event {
        case .prompt(let cwd):
            if let cwd { projectPath = cwd }
            // First shell prompt → the shell is ready for the queued launch.
            if pendingLaunchCommand != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                    self?.firePendingLaunch()
                }
            }
        case .exec(let command, let cwd):
            let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            blocks.append(CommandBlock(command: trimmed, cwd: cwd, startedAt: Date()))
            if blocks.count > 500 { blocks.removeFirst(blocks.count - 500) }
        case .done:
            break // handled via onCommandFinished (carries captured output)
        }
    }

    /// Finalize the running block: record status, render captured output into a
    /// card off the main thread, then clear the live terminal so the output
    /// isn't shown twice.
    private func finishCommand(exitCode: Int32, bytes: [UInt8], altScreen: Bool) {
        lastExitCode = exitCode
        guard let idx = blocks.lastIndex(where: { $0.isRunning }) else {
            // No tracked block (e.g. bare Enter) — still tidy the viewport.
            scheduleViewportClear()
            return
        }
        blocks[idx].finishedAt = Date()
        blocks[idx].exitCode = exitCode
        blocks[idx].interactive = altScreen
        let blockID = blocks[idx].id

        if !altScreen, !bytes.isEmpty {
            let cols = terminalView.getTerminal().cols
            let font = settings.resolvedFont()
            let theme = settings.theme
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let r = BlockRenderer.render(bytes: bytes, cols: cols, font: font, theme: theme)
                DispatchQueue.main.async {
                    guard let self, let i = self.blocks.firstIndex(where: { $0.id == blockID }) else { return }
                    self.blocks[i].output = r.attributed
                    self.blocks[i].outputLineCount = r.lineCount
                }
            }
        }
        scheduleViewportClear()
    }

    private func scheduleViewportClear() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.terminalView.clearViewport()
        }
    }

    /// Re-run (or run) a command by typing it into the shell. Sends Ctrl-U
    /// first to clear any partial content sitting in the line editor, so an
    /// injected command can never inherit a stray prefix, then executes it.
    func rerun(_ command: String) {
        terminalView.send(txt: "\u{15}" + command + "\n")
    }

    /// Type text into the shell without executing (composer / palette insert).
    func insert(_ text: String) {
        terminalView.send(txt: text)
    }

    // MARK: - Lifecycle

    /// Start the login shell, injecting IPC identity, then optionally run the
    /// configured default launch command (e.g. `claude --dangerously-skip-permissions`).
    func start() {
        var env = Terminal.getEnvironmentVariables(termName: "xterm-256color")
        env.append("\(IPC.sessionEnvKey)=\(id)")
        env.append("IDEALIZE_SOCK=\(IPC.socketPath)")
        env.append("IDEALIZE=1")
        // Ensure the bundled `idealize` CLI is on PATH.
        if let cliDir = CLIInstaller.installShim() {
            let existing = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"
            env.removeAll { $0.hasPrefix("PATH=") }
            env.append("PATH=\(cliDir):\(existing)")
        }

        // Install shell integration (blocks/command tracking) and configure the
        // shell to load it.
        ShellIntegration.install()
        let shell = (settings.shellPath as NSString).lastPathComponent
        var args = ["-l"]
        if shell == "zsh" {
            env.append(contentsOf: ShellIntegration.zshEnvironment(
                currentEnv: ProcessInfo.processInfo.environment))
        } else if shell == "bash" {
            args = ["--login", "--rcfile", ShellIntegration.rootDir + "/idealize.bash", "-i"]
        }

        terminalView.startProcess(
            executable: settings.shellPath,
            args: args,
            environment: env,
            execName: nil,
            currentDirectory: projectPath
        )

        startStatusPolling()
        installScrollFix()

        if settings.launchOnNewTerminal {
            let command = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
            if !command.isEmpty {
                // Send when the shell shows its first prompt (reliable), with a
                // fallback in case the shell-integration event never arrives.
                pendingLaunchCommand = command
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                    self?.firePendingLaunch()
                }
            }
        }
    }

    /// A launch command (e.g. `claude …`) queued to run once the shell is ready.
    private var pendingLaunchCommand: String?
    /// Last time Claude's "working" marker was on screen (for the grace period).
    private var lastWorkingSeen: Date?

    private func firePendingLaunch() {
        guard let cmd = pendingLaunchCommand else { return }
        pendingLaunchCommand = nil
        terminalView.send(txt: "\u{15}" + cmd + "\n")   // Ctrl-U clears any partial line
    }

    func terminate() {
        statusTimer?.invalidate()
        statusTimer = nil
        if let m = scrollMonitor { NSEvent.removeMonitor(m); scrollMonitor = nil }
        terminalView.process.terminate()
    }

    // MARK: - Trackpad scroll fix

    private var scrollMonitor: Any?
    private var scrollAccumulator: CGFloat = 0

    /// SwiftTerm's `scrollWheel` reads only the legacy `event.deltaY`, which is 0
    /// for trackpad precise scrolling → two-finger scroll does nothing. It's not
    /// `open`, so we can't override it; instead a local monitor handles precise
    /// scroll over this terminal by driving its (public) scrollback API.
    private func installScrollFix() {
        guard scrollMonitor == nil else { return }
        scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            guard let self else { return event }
            // Only drive the terminal when it's the active (revealed) view —
            // otherwise let the scroll reach the chat overlay's ScrollView.
            guard self.revealTerminal else { return event }
            // Classic mouse wheels work via SwiftTerm already; only fix trackpads.
            guard event.hasPreciseScrollingDeltas else { return event }
            let tv = self.terminalView
            guard let win = tv.window, event.window === win else { return event }
            let p = tv.convert(event.locationInWindow, from: nil)
            guard tv.bounds.contains(p) else { return event }
            self.scrollAccumulator += event.scrollingDeltaY
            let lines = Int(self.scrollAccumulator / 12)
            if lines != 0 {
                self.scrollAccumulator -= CGFloat(lines) * 12
                if lines > 0 { tv.scrollUp(lines: lines) } else { tv.scrollDown(lines: -lines) }
            }
            return nil   // consume — we've handled this scroll
        }
    }

    // MARK: - Theming

    func applyTheme(_ theme: Theme, font: NSFont) {
        // Layer the per-panel Terminal appearance over the theme. Background and
        // foreground colours + font size/family are honoured; the grid keeps a
        // single (ideally monospaced) font so alignment stays intact.
        let a = settings.appearance(.terminal)
        let bg = (a.bgMode != FillMode.inherit.rawValue ? NSColor(hex: a.bgColorHex) : nil) ?? theme.background
        let fg = NSColor(hex: a.textColorHex) ?? theme.foreground
        terminalView.nativeBackgroundColor = bg
        terminalView.nativeForegroundColor = fg
        terminalView.caretColor = theme.cursor
        terminalView.selectedTextBackgroundColor = theme.selection
        terminalView.font = terminalFont(base: font, appearance: a)
        let palette = theme.ansi.map { $0.toSwiftTermColor() }
        terminalView.getTerminal().installPalette(colors: palette)
        terminalView.needsDisplay = true
    }

    /// Resolve the terminal font, honouring a per-panel font/size override.
    private func terminalFont(base: NSFont, appearance a: PanelAppearance) -> NSFont {
        guard !a.fontName.isEmpty || a.fontSize > 0 else { return base }
        let famSize = a.fontSize > 0 ? CGFloat(a.fontSize) : base.pointSize
        let famName = a.fontName.isEmpty ? (base.familyName ?? base.fontName) : a.fontName
        return NSFont(name: famName, size: famSize)
            ?? NSFontManager.shared.font(withFamily: famName, traits: [], weight: 5, size: famSize)
            ?? base.withSize(famSize)
    }

    // MARK: - Mailbox

    func deliver(_ message: IPCMessage) {
        mailbox.append(message)
        DispatchQueue.main.async {
            self.unreadCount = self.mailbox.count
        }
    }

    /// Drain (and return) all queued messages.
    func drainMailbox() -> [IPCMessage] {
        let messages = mailbox
        mailbox.removeAll()
        DispatchQueue.main.async { self.unreadCount = 0 }
        return messages
    }

    func peekMailbox() -> [IPCMessage] { mailbox }

    func markRead() {
        unreadCount = 0
        hasActivity = false
        // The session has been looked at: remember its current reply as seen, so
        // a "Complete" tag settles back to idle. "Waiting" stays — that still
        // needs an answer, and persists until acted on.
        acknowledgedMessage = assistantMessage
        if agentStatus == .complete { agentStatus = .idle }
    }

    var label: String {
        if let proj = projectPath, !proj.isEmpty {
            return (proj as NSString).lastPathComponent
        }
        return title
    }

    var sessionInfo: IPCSessionInfo {
        IPCSessionInfo(
            id: id,
            title: label,
            projectPath: projectPath,
            processName: processName,
            status: customStatus ?? (isShellForeground ? "idle" : processName),
            unread: mailbox.count
        )
    }

    // MARK: - Status polling

    private func startStatusPolling() {
        statusTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.pollProcess()
        }
        RunLoop.main.add(timer, forMode: .common)
        statusTimer = timer
        pollProcess()
    }

    private func pollProcess() {
        guard let process = terminalView.process, process.running else { return }
        if let fg = ProcessInspector.foregroundProcessName(
            childfd: process.childfd, shellPid: process.shellPid) {
            if fg.name != processName { processName = fg.name }
            if fg.isShell != isShellForeground { isShellForeground = fg.isShell }
        }
        // Click-to-focus: if our terminal holds first responder, report focus.
        if let responder = terminalView.window?.firstResponder as? NSView,
           responder === terminalView || responder.isDescendant(of: terminalView) {
            onUserFocused?(id)
        }

        refreshAssistantMessage()
        detectPrompt()
    }

    /// Read the visible terminal screen as plain text lines.
    private func readVisibleScreen() -> [String] {
        let term = terminalView.getTerminal()
        let rows = term.rows
        let top = term.getTopVisibleRow()
        var out: [String] = []
        for y in 0..<rows {
            guard let line = term.getScrollInvariantLine(row: top + y) else { out.append(""); continue }
            var s = ""
            for col in 0..<line.count {
                var ch = line[col].getCharacter()
                if ch == "\u{0}" { ch = " " }
                s.append(ch)
            }
            out.append(s)
        }
        return out
    }

    /// Detect a Claude confirmation/choice prompt on screen so the chat UI can
    /// offer answer buttons; also lift Claude's status line + tip.
    private func detectPrompt() {
        guard isClaudeRunning || inAltScreen else {
            if pendingPrompt != nil { pendingPrompt = nil }
            if liveInteractivePrompt { liveInteractivePrompt = false }
            if workingStatus != nil { workingStatus = nil }
            if workingTip != nil { workingTip = nil }
            if botWorking { botWorking = false }
            if agentStatus != .idle { agentStatus = .idle }
            return
        }
        let lines = readVisibleScreen()
        let prompt = ClaudePromptParser.parse(lines)
        if prompt != pendingPrompt {
            pendingPrompt = prompt
            // Surface the question even if the modal was minimised.
            if prompt != nil { chatMinimised = false }
        }
        // Claude is actively generating while its working status is on screen.
        // Markers flicker between spinner frames / tool calls, so once seen we
        // keep "working" for a short grace period to avoid the animation
        // dropping back to the last message mid-task. The marker disappearing
        // for >1.5s (Claude idle at its prompt) ends it — no permanent stuck.
        // Match on PREFIXES — a narrow pane truncates the line (e.g. the marker
        // renders as "esc to inter…"), so the full "esc to interrupt" string
        // often isn't present on screen.
        let markerVisible = lines.contains { l in
            let s = l.lowercased()
            return s.contains("esc to inter")     // "esc to interrupt" (poss. truncated)
                || s.contains("esc to canc")      // "esc to cancel" (poss. truncated)
                || s.contains("to interrupt")
                || s.contains("ctrl+t to")
                || s.contains("· interrupt")
        }
        if markerVisible { lastWorkingSeen = Date() }
        let recentlyWorking = lastWorkingSeen.map { Date().timeIntervalSince($0) < 1.5 } ?? false
        let working = prompt == nil && (markerVisible || recentlyWorking)
        if working != botWorking { botWorking = working }
        let (status, tip) = working ? ClaudePromptParser.statusAndTip(lines) : (nil, nil)
        if status != workingStatus { workingStatus = status }
        if tip != workingTip { workingTip = tip }
        // An interactive prompt we couldn't structure into buttons (arrow-key
        // menu, trust dialog, free-form confirm). Look only at the bottom of the
        // screen, where Claude renders its prompt footers, so prose in a finished
        // answer can't trip it. When live, the chat must not present the stale
        // transcript answer as if it were current.
        let footer = lines.suffix(8)
        let interactive = prompt == nil && !working && footer.contains { l in
            let s = l.lowercased()
            return s.contains("esc to cancel")
                || s.contains("↑/↓")
                || s.contains("arrow keys")
                || s.contains("enter to confirm")
                || s.contains("press enter")
                || s.contains("to select")
        }
        if interactive != liveInteractivePrompt { liveInteractivePrompt = interactive }
        updateAgentStatus()
    }

    /// Map the live `pendingPrompt`/`botWorking` flags onto the higher-level
    /// `agentStatus` tag. `waiting` (a question) wins over everything; a
    /// working→idle edge with no question outstanding means a turn just
    /// completed, and that `.complete` tag sticks until the tab is focused.
    /// Map the live terminal/transcript state onto the higher-level status tag.
    /// Stateless — derived fresh each poll from what's on screen and Claude's
    /// last reply, so it lands correctly even on a freshly relaunched app with a
    /// Claude session already sitting idle (no need to have witnessed the
    /// working→idle transition).
    private func updateAgentStatus() {
        if pendingPrompt != nil || liveInteractivePrompt {
            agentStatus = .waiting           // a choice box / live prompt is up
        } else if botWorking {
            agentStatus = .working
        } else if let msg = assistantMessage, !msg.isEmpty {
            // Claude is idle at its prompt with a completed reply on the table.
            // Claude often asks its question in prose ("Want me to…?"), so any
            // question mark in the reply means Waiting; an answered-or-statement
            // reply is Complete until the tab is focused (then it's idle).
            if messageContainsQuestion(msg) {
                agentStatus = .waiting
            } else {
                agentStatus = (msg == acknowledgedMessage) ? .idle : .complete
            }
        } else {
            agentStatus = .idle
        }
    }

    /// True when a completed message contains a question — used to flag a turn
    /// as "waiting on you" even without a numbered choice prompt. Fenced and
    /// inline code are stripped first so code punctuation (TS ternaries, `?.`
    /// optional chaining, regex…) doesn't count as a question.
    private func messageContainsQuestion(_ msg: String) -> Bool {
        var prose = ""
        var inFence = false
        for line in msg.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            }
            if inFence { continue }
            prose += line + "\n"
        }
        let stripped = prose.replacingOccurrences(
            of: "`[^`]*`", with: "", options: .regularExpression)
        return stripped.contains("?")
    }

    /// Answer a detected prompt by pressing the option's number in Claude.
    func answerPrompt(_ option: ClaudePrompt.Option) {
        terminalView.send(txt: "\(option.number)")
        pendingPrompt = nil
        botWorking = true
        agentStatus = .working
    }

    /// Toggle a checkbox option in a multi-select prompt (sends its number to
    /// flip it). Keeps the prompt open so the screen re-parses the new state.
    func togglePromptOption(_ option: ClaudePrompt.Option) {
        terminalView.send(txt: "\(option.number)")
    }

    /// Confirm a multi-select prompt (Enter), proceeding with the current ticks.
    func confirmPrompt() {
        terminalView.send(txt: "\r")
        pendingPrompt = nil
        botWorking = true
        agentStatus = .working
    }

    /// While a Claude session is running here, pull its latest completed message
    /// from Claude Code's transcript (only re-reading when the file changes).
    private func refreshAssistantMessage() {
        guard let cwd = projectPath, !cwd.isEmpty else { return }
        guard isClaudeRunning || inAltScreen else { return }
        guard let url = ClaudeTranscript.newestTranscript(forCwd: cwd) else { return }
        let mtime = ClaudeTranscript.modDate(url)
        if url == transcriptURL, mtime == transcriptMTime { return }
        transcriptURL = url
        transcriptMTime = mtime
        let (q, a) = ClaudeTranscript.lastExchange(in: url)
        if let q, q != userQuestion { userQuestion = q }
        if a != assistantMessage { assistantMessage = a }
        // NB: botWorking is driven by the on-screen "esc to interrupt" marker in
        // detectPrompt(), not the transcript — the transcript heuristic got stuck.
    }

    /// Send a line of input: to the running TUI (e.g. Claude) on the alternate
    /// screen, or to the shell prompt otherwise.
    func submitInput(_ text: String) {
        if tuiActive {
            // Talking to a running Claude (or other TUI): show the question and
            // clear the prior answer while it works.
            userQuestion = text
            assistantMessage = nil
            botWorking = true
            agentStatus = .working
            sendLineToTUI(text)
        } else if blocks.isEmpty {
            // Fresh terminal — treat the first input as a chat: launch Claude,
            // then deliver the message once it's ready.
            userQuestion = text
            assistantMessage = nil
            botWorking = true
            agentStatus = .working
            let launch = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
            let cmd = launch.isEmpty ? "claude --dangerously-skip-permissions" : launch
            terminalView.send(txt: "\u{15}" + cmd + "\n")
            waitForClaudeThenSend(text, attemptsLeft: 30)
        } else {
            // The shell is in use (e.g. after exiting Claude) — run as a normal
            // shell command. Type `claude` to start a new chat. We do NOT
            // auto-relaunch Claude here.
            rerun(text)
        }
    }

    /// Poll until Claude has taken over (alt-screen / running), then deliver the
    /// queued first message. Stops if Claude never appears.
    private func waitForClaudeThenSend(_ text: String, attemptsLeft: Int) {
        guard attemptsLeft > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            if self.tuiActive {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.sendLineToTUI(text)
                }
            } else {
                self.waitForClaudeThenSend(text, attemptsLeft: attemptsLeft - 1)
            }
        }
    }

    // MARK: - Helpers

    private static func makeID() -> String {
        // Short, human-typeable id (e.g. "t-4f7a").
        let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        return "t-" + String(uuid.prefix(4))
    }

}

// MARK: - LocalProcessTerminalViewDelegate

extension TerminalSession: LocalProcessTerminalViewDelegate {
    func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}

    func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { self.title = trimmed }
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {
        if let dir = directory {
            // OSC 7 sends file:// URLs sometimes.
            let path = dir.replacingOccurrences(of: "file://", with: "")
            projectPath = (path as NSString).standardizingPath
        }
    }

    func processTerminated(source: TerminalView, exitCode: Int32?) {
        isRunning = false
        statusTimer?.invalidate()
        workspace?.sessionDidTerminate(self)
    }
}

// MARK: - NSColor → SwiftTerm.Color

extension NSColor {
    func toSwiftTermColor() -> SwiftTerm.Color {
        let c = usingColorSpace(.sRGB) ?? self
        return SwiftTerm.Color(
            red: UInt16(c.redComponent * 65535),
            green: UInt16(c.greenComponent * 65535),
            blue: UInt16(c.blueComponent * 65535)
        )
    }
}
