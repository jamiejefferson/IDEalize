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

    /// The folder the file explorer shows for this session: its project directory,
    /// or home when it has none. Both the tree and `idealize reveal` read this, so
    /// they can't disagree about what counts as "inside" the session.
    var explorerRoot: String {
        if let p = projectPath, !p.isEmpty { return p }
        return FileManager.default.homeDirectoryForCurrentUser.path
    }
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
    /// The previous turn's answer, pinned the moment a follow-up is sent so the
    /// chat keeps showing it (rather than blanking) while Claude works on the next
    /// reply. Only consulted by the UI during a working turn.
    @Published var priorAnswer: String?
    /// The latest user prompt (shown condensed at the top of the chat panel).
    @Published var userQuestion: String?
    /// Full Q&A history parsed from the transcript, oldest→newest. Powers the
    /// chat's back/forward navigation through past exchanges.
    @Published var exchanges: [ClaudeTranscript.Exchange] = []
    /// When the user has paged back, the index into `exchanges` being shown.
    /// nil = following the live/latest exchange (the default).
    @Published var historyIndex: Int?
    /// Claude is actively generating a reply (drives the tab working spinner).
    @Published var botWorking: Bool = false
    /// True from the instant a chat message is submitted until Claude visibly
    /// starts (`botWorking`) or its reply lands. Bridges the ~1s gap where the
    /// poll's `detectPrompt()` would otherwise recompute `botWorking = false`
    /// because Claude hasn't drawn its "esc to interrupt" marker yet — so the
    /// chat shows a solid "working" state the moment you hit send.
    @Published var awaitingReply: Bool = false
    /// When the current `awaitingReply` began — used for a safety long-stop so an
    /// aborted launch can't wedge the working banner on forever.
    private var pendingSince: Date?
    /// Which "working" critter to show — bumped once per submitted task so the
    /// animal is chosen at send and stays put for the whole turn (rather than
    /// changing as the transcript's exchange count ticks up mid-task).
    @Published var taskCritter: Int = 0
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
    /// How many tokens this chat's Claude conversation is currently carrying in
    /// context (from the transcript's latest usage). Drives the per-chat context
    /// readout in the rail. `nil` until Claude has written usage.
    @Published var contextTokens: Int?
    /// The context window that latest turn's model allows (200k, or 1M for a
    /// `[1m]` session) — the denominator for `contextFraction`.
    @Published var contextLimit: Int?
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
    /// The session id we launched Claude with (`claude --session-id <uuid>`), so
    /// we read exactly this terminal's transcript rather than the newest file in
    /// the project dir. Without it, a Claude running elsewhere in the same folder
    /// (Warp, another tab, a bare CLI) can be picked up instead, and its messages
    /// would bleed into this chat. nil when Claude was started by hand.
    private var boundSessionId: String?

    /// Augment a `claude …` launch with a fresh `--session-id` so its transcript
    /// is identifiable, unless the command already selects a session. Returns the
    /// command unchanged for non-Claude launches.
    private func augmentClaudeLaunch(_ command: String) -> String {
        guard TerminalSession.isClaudeCommand(command) else { return command }
        let selectors = ["--session-id", "--resume", "--continue", " -r ", " -c "]
        if selectors.contains(where: { command.contains($0) })
            || command.hasSuffix(" -r") || command.hasSuffix(" -c") { return command }
        let uuid = UUID().uuidString.lowercased()
        boundSessionId = uuid
        return command + " --session-id \(uuid)"
    }

    // Blocks (Warp-style command tracking via shell integration).
    @Published var blocks: [CommandBlock] = []
    @Published var lastExitCode: Int32?
    /// Command currently running (if any).
    var runningCommand: String? { blocks.last(where: { $0.isRunning })?.command }
    /// A Claude Code session is the current foreground command. Reliable even
    /// when Claude doesn't use the alternate screen / reports an odd proc name.
    var isClaudeRunning: Bool {
        guard let cmd = runningCommand?.lowercased() else { return false }
        return TerminalSession.isClaudeCommand(cmd)
    }

    /// Whether a command string invokes `claude` — bare, with args, after a
    /// separator (`&&`/`;`), or as a full path. The single source of truth for
    /// "is this a Claude session", used by the running-detection, the
    /// `--session-id` augmentation, and the persisted snapshot's `wasClaude`.
    static func isClaudeCommand(_ command: String) -> Bool {
        command.range(of: "(^|[ /&;])claude($| )", options: .regularExpression) != nil
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

    /// A one-off launch command for this session, overriding the global default
    /// (`settings.defaultLaunchCommand`). Set before `start()`. Used by the Service
    /// Hatch to drop this tab straight into a Claude dev session on IDEalize itself.
    var launchOverride: String?

    /// Force a plain shell: skip the auto-launch (e.g. `claude …`) even when the
    /// global default would run one. Set before `start()`. Used when restoring a
    /// chat that was a bare shell, so it doesn't get an unexpected Claude on relaunch.
    var suppressAutoLaunch: Bool = false

    /// This tab was opened via the Service Hatch (a Claude dev session on
    /// IDEalize's own source). Drives the themed opening banner in the chat.
    @Published var isServiceHatch: Bool = false

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

        // When no project folder is set, start the shell in the user's home
        // directory. A Finder/Dock-launched .app inherits `/` as its working
        // directory, so passing nil here would spawn the shell in `/` and the
        // shell-integration prompt would then report `cwd=/`.
        let startDir = (projectPath?.isEmpty == false)
            ? projectPath!
            : FileManager.default.homeDirectoryForCurrentUser.path
        terminalView.startProcess(
            executable: settings.shellPath,
            args: args,
            environment: env,
            execName: nil,
            currentDirectory: startDir
        )

        startStatusPolling()
        installScrollFix()

        // A per-session override (Service Hatch) wins; otherwise fall back to the
        // configured default launch, if enabled.
        let launch: String = {
            if let o = launchOverride?.trimmingCharacters(in: .whitespacesAndNewlines), !o.isEmpty {
                return o
            }
            if suppressAutoLaunch { return "" }
            return settings.launchOnNewTerminal
                ? settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
                : ""
        }()
        launchIsClaude = !launch.isEmpty && TerminalSession.isClaudeCommand(launch)
        if !launch.isEmpty {
            // Send when the shell shows its first prompt (reliable), with a
            // fallback in case the shell-integration event never arrives.
            pendingLaunchCommand = launch
            claudeLaunchInFlight = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.firePendingLaunch()
            }
        }
    }

    /// A launch command (e.g. `claude …`) queued to run once the shell is ready.
    private var pendingLaunchCommand: String?
    /// True from when we queue/issue a `claude` launch until it becomes the
    /// foreground TUI (or the attempt is abandoned). The single coordination
    /// point between the auto-launch and a user's first message: while it's set,
    /// a first message is delivered to the coming Claude rather than racing in a
    /// second `claude --session-id …` — the double-launch that left two stillborn
    /// transcripts and bound the chat to the wrong one.
    private var claudeLaunchInFlight = false
    /// Last time Claude's "working" marker was on screen (for the grace period).
    private var lastWorkingSeen: Date?

    private func firePendingLaunch() {
        guard let cmd = pendingLaunchCommand else { return }
        pendingLaunchCommand = nil
        claudeLaunchInFlight = true
        terminalView.send(txt: "\u{15}" + augmentClaudeLaunch(cmd) + "\n")   // Ctrl-U clears any partial line
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
    /// scroll over this terminal.
    ///
    /// Two cases: when a foreground TUI is tracking the mouse (Claude Code, vim,
    /// less, htop — all of which enable mouse reporting and run on the alternate
    /// screen), we forward the wheel as mouse-wheel events so the app scrolls its
    /// own viewport. The alt screen has no scrollback, so SwiftTerm's own
    /// `scrollUp/Down` would move nothing — which is exactly why scrolling looked
    /// dead inside Claude. Otherwise (a plain shell), we drive SwiftTerm's
    /// scrollback API to page through history.
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
            let notches = Int(self.scrollAccumulator / 12)
            guard notches != 0 else { return nil }   // consume; wait for a full notch
            self.scrollAccumulator -= CGFloat(notches) * 12

            let terminal = tv.getTerminal()
            if terminal.mouseMode != .off {
                // The foreground app is tracking the mouse — forward wheel notches
                // as mouse-wheel events (button 4 = up, 5 = down) at the pointer's
                // cell so it scrolls itself.
                let cols = max(terminal.cols, 1), rows = max(terminal.rows, 1)
                let col = min(max(0, Int(p.x / (tv.bounds.width / CGFloat(cols)))), cols - 1)
                // The view is not flipped (y grows upward), so invert for the grid row.
                let row = min(max(0, Int((tv.bounds.height - p.y) / (tv.bounds.height / CGFloat(rows)))), rows - 1)
                let button = notches > 0 ? 4 : 5
                let flags = terminal.encodeButton(button: button, release: false, shift: false, meta: false, control: false)
                for _ in 0..<abs(notches) { terminal.sendEvent(buttonFlags: flags, x: col, y: row) }
            } else if notches > 0 {
                tv.scrollUp(lines: notches)
            } else {
                tv.scrollDown(lines: -notches)
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

    /// "This chat has something new for you" — a finished or blocked Claude turn,
    /// or an unread inter-agent message / background output. Drives the bold-text
    /// unread signal in the session rail. Cleared by `markRead()` on focus.
    var needsAttention: Bool {
        hasActivity || unreadCount > 0 || agentStatus == .complete || agentStatus == .waiting
    }

    /// Whether this session is (or was) a Claude chat — its launch command was a
    /// `claude` invocation, we bound a session id, or Claude is live now. Recorded
    /// in the rail's persisted snapshot so a restored chat relaunches Claude.
    /// `launchIsClaude` is set synchronously in `start()` so a chat saved before
    /// Claude finishes coming up is still recorded correctly.
    var wasClaudeLaunched: Bool { launchIsClaude || boundSessionId != nil || isClaudeRunning }

    /// The Claude Code session id whose transcript this chat is following (the
    /// transcript file's basename), if any. Lets an archived chat be reopened with
    /// `--resume` so the conversation picks up where it left off.
    var claudeSessionId: String? {
        transcriptURL?.deletingPathExtension().lastPathComponent
    }

    /// How full this chat's Claude context is (0…1), or `nil` when unknown / not a
    /// Claude chat. Feeds the per-chat context gauge that signals when to archive
    /// and start fresh.
    var contextFraction: Double? {
        guard let t = contextTokens, t > 0 else { return nil }
        let limit = contextLimit ?? ClaudeTranscript.defaultContextWindowLimit
        return min(1, Double(t) / Double(limit))
    }

    /// An explicit one-line "what I'm working on" the agent posts via
    /// `idealize note --mine`. Overrides the auto-derived activity line in the
    /// project's shared status view, so a chat can state its intent in its own
    /// words. Cleared with an empty `--mine`.
    @Published var agentNote: String?

    /// A one-line "what this chat is working on", for the project's shared status
    /// view. Prefers the agent's explicit note; otherwise derived from what Claude
    /// is currently doing (its live status, last prompt, or last reply).
    var activityLine: String {
        if let n = agentNote?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty {
            return n
        }
        func firstLine(_ s: String, _ limit: Int = 72) -> String {
            let line = s.split(whereSeparator: \.isNewline).first.map(String.init) ?? s
            let t = line.trimmingCharacters(in: .whitespaces)
            return t.count > limit ? String(t.prefix(limit)) + "…" : t
        }
        switch agentStatus {
        case .waiting:
            return "waiting on you"
        case .working:
            if let q = userQuestion, !q.isEmpty { return "working on: " + firstLine(q) }
            return "working…"
        case .complete:
            if let a = assistantMessage, !a.isEmpty { return "just finished: " + firstLine(a) }
            return "finished"
        case .idle:
            if let q = userQuestion, !q.isEmpty { return firstLine(q) }
            return isClaudeRunning ? "ready" : "shell"
        }
    }

    /// The resolved launch command for this session was a `claude` invocation.
    private(set) var launchIsClaude = false

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

        // An auto-launched Claude with no queued message has no waiter to clear
        // the in-flight flag — release it here once Claude owns the pane.
        if claudeLaunchInFlight && tuiActive { claudeLaunchInFlight = false }

        refreshAssistantMessage()
        detectPrompt()

        // Session @Published changes don't reach the WorkspaceTab/Workspace that
        // the session rail groups by, so nudge the workspace when this chat's
        // unread/attention state flips — that's what re-evaluates the bold-text
        // unread signal on the chat row and its project header.
        let attn = needsAttention
        if attn != lastAttention {
            lastAttention = attn
            workspace?.objectWillChange.send()
        }
    }

    private var lastAttention = false

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
            if awaitingReply { awaitingReply = false }
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
        // The submit-time `awaitingReply` banner hands off the moment Claude
        // visibly starts (its marker → `working`) or puts up a prompt; a launch
        // that stalls clears after a grace period so it can't wedge on forever.
        if awaitingReply {
            if working || pendingPrompt != nil || liveInteractivePrompt {
                awaitingReply = false
            } else if let since = pendingSince, Date().timeIntervalSince(since) > 90 {
                awaitingReply = false
            }
        }
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

    /// Cancel the prompt Claude is currently working on. Sends ESC — the key
    /// Claude's TUI itself advertises ("esc to interrupt") — to stop it mid-turn.
    func interrupt() {
        guard tuiActive else { return }
        terminalView.send(txt: "\u{1b}")   // ESC
        pendingPrompt = nil
        // Reflect the stop immediately; the on-screen marker poll keeps it honest.
        botWorking = false
        agentStatus = .idle
    }

    /// While a Claude session is running here, pull its latest completed message
    /// from Claude Code's transcript (only re-reading when the file changes).
    private func refreshAssistantMessage() {
        guard let cwd = projectPath, !cwd.isEmpty else { return }
        guard isClaudeRunning || inAltScreen else { return }
        // Prefer the transcript for the session we launched (so a Claude running
        // elsewhere in the same folder can't bleed in); fall back to newest only
        // when Claude was started by hand and we never bound a session id.
        let url: URL
        if let id = boundSessionId, let bound = ClaudeTranscript.transcript(forCwd: cwd, sessionId: id) {
            // Normally read exactly the session we launched. But the auto-launch
            // can go stillborn (Claude writes a few init lines under our
            // --session-id, then the user's real conversation ends up under a
            // different id). When the bound transcript holds no real exchange yet
            // a strictly-newer transcript exists in the same folder, the user is
            // really talking to that one — follow it, or the chat reads the empty
            // bound file forever. A live parallel-tab Claude has real content, so
            // this still won't bleed it in.
            if let newest = ClaudeTranscript.newestTranscript(forCwd: cwd),
               newest != bound,
               ClaudeTranscript.modDate(newest) > ClaudeTranscript.modDate(bound),
               transcriptIsStillborn(bound) {
                url = newest
            } else {
                url = bound
            }
        } else if boundSessionId == nil, let newest = ClaudeTranscript.newestTranscript(forCwd: cwd) {
            url = newest
        } else {
            return   // bound session's file not written yet — wait, don't grab another
        }
        let mtime = ClaudeTranscript.modDate(url)
        if url == transcriptURL, mtime == transcriptMTime { return }
        transcriptURL = url
        transcriptMTime = mtime
        let all = ClaudeTranscript.allExchanges(in: url)
        if all != exchanges { exchanges = all }
        let ctx = ClaudeTranscript.contextUsage(in: url)
        if ctx?.tokens != contextTokens { contextTokens = ctx?.tokens }
        if ctx?.limit != contextLimit { contextLimit = ctx?.limit }
        let q = all.last?.question
        let a = all.last?.answer
        if let q, q != userQuestion { userQuestion = q }
        if a != assistantMessage {
            assistantMessage = a
            // A real reply landed — the submit-time working banner can stand down.
            if awaitingReply, let a, !a.isEmpty { awaitingReply = false }
        }
        // NB: botWorking is driven by the on-screen "esc to interrupt" marker in
        // detectPrompt(), not the transcript — the transcript heuristic got stuck.
    }

    /// A transcript with no real prompt or answer — e.g. a `--session-id` launch
    /// that wrote a few init lines, then never carried a conversation.
    private func transcriptIsStillborn(_ url: URL) -> Bool {
        let e = ClaudeTranscript.lastExchange(in: url)
        return e.question == nil && e.answer == nil
    }

    /// Send a line of input: to the running TUI (e.g. Claude) on the alternate
    /// screen, or to the shell prompt otherwise.
    // MARK: - Chat history navigation

    /// True when the user has paged back to an earlier exchange (not live).
    var isBrowsingHistory: Bool { historyIndex != nil }

    /// The question to render: the parked historical one while browsing, else live.
    var displayedQuestion: String? {
        if let i = historyIndex, exchanges.indices.contains(i) { return exchanges[i].question }
        return userQuestion
    }

    /// The answer to render: the parked historical one while browsing, else live.
    var displayedAnswer: String? {
        if let i = historyIndex, exchanges.indices.contains(i) { return exchanges[i].answer }
        return assistantMessage
    }

    /// "2 / 12" position indicator, only while browsing.
    var historyPosition: String? {
        guard let i = historyIndex else { return nil }
        return "\(i + 1) / \(exchanges.count)"
    }

    /// The index currently shown (live = the last exchange). Read by the chat's
    /// exchange stepper to label the position ("3 of 12").
    var shownIndex: Int { historyIndex ?? (exchanges.count - 1) }

    var canGoBack: Bool { shownIndex > 0 }
    var canGoForward: Bool { historyIndex != nil }

    /// Step back one exchange (older).
    func historyBack() {
        guard exchanges.count > 1, shownIndex > 0 else { return }
        historyIndex = shownIndex - 1
    }

    /// Step forward one exchange; returning to the newest resumes live following.
    func historyForward() {
        guard let i = historyIndex else { return }
        historyIndex = (i + 1 >= exchanges.count - 1) ? nil : i + 1
    }

    func submitInput(_ text: String) {
        historyIndex = nil   // a new message snaps the chat back to live
        if tuiActive {
            // Talking to a running Claude (or other TUI): show the new question but
            // keep the previous answer pinned (in `priorAnswer`) so the chat doesn't
            // blank out while Claude works — `assistantMessage` then updates live to
            // the new turn's narration as the transcript records it.
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            if pendingPrompt != nil {
                // Claude is showing a selection prompt (numbered menu). Typing a
                // fresh instruction into that menu gets swallowed — the menu reads
                // it as a filter/selection — so the message silently vanished.
                // Exit the menu first (ESC), then deliver the text to the clean
                // input line a beat later so it actually registers as a message.
                pendingPrompt = nil
                terminalView.send(txt: "\u{1b}")   // ESC — leave the menu
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                    self?.sendLineToTUI(text)
                }
            } else {
                sendLineToTUI(text)
            }
        } else if claudeLaunchInFlight {
            // A launch we already issued (auto-launch, or an earlier message) is
            // still coming up. Deliver to it — never start a second Claude, which
            // would race two `--session-id` sessions and bind the chat to a
            // stillborn one.
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            firePendingLaunch()   // no-op if the queued auto-launch already fired
            waitForClaudeThenSend(text, attemptsLeft: 30)
        } else if blocks.isEmpty {
            // Fresh terminal — treat the first input as a chat: launch Claude,
            // then deliver the message once it's ready.
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            claudeLaunchInFlight = true
            let launch = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
            let cmd = launch.isEmpty ? "claude --dangerously-skip-permissions" : launch
            terminalView.send(txt: "\u{15}" + augmentClaudeLaunch(cmd) + "\n")
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
        guard attemptsLeft > 0 else {
            claudeLaunchInFlight = false   // gave up — let a later message relaunch
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            if self.tuiActive {
                self.claudeLaunchInFlight = false   // Claude is up; it owns the pane now
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
        claudeLaunchInFlight = false
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
