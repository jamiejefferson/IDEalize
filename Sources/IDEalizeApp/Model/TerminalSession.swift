import SwiftUI
import AppKit
import SwiftTerm
import IDEalizeCore

/// High-level status of the agent in a session, surfaced as a tag on its tab
/// so you can tell at a glance which sessions need you.
/// - `working`: the agent is actively generating.
/// - `waiting`: the agent asked a question and is blocked on your answer — the
///   one that needs attention.
/// - `complete`: the agent finished its turn with nothing outstanding.
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
    /// or nil when it has none. (There is deliberately no home-directory fallback:
    /// it made anything under ~ revealable over IPC.) Both the tree and
    /// `idealize reveal` read this, so they can't disagree about what counts as
    /// "inside" the session.
    var explorerRoot: String? {
        guard let p = projectPath, !p.isEmpty, p != "/" else { return nil }
        return p
    }
    @Published var processName: String = "zsh"
    @Published var isShellForeground: Bool = true
    @Published var isRunning: Bool = true
    @Published var customStatus: String?
    @Published var unreadCount: Int = 0
    @Published var hasActivity: Bool = false   // output since last focused
    /// A full-screen TUI (agent CLI, vim, top, less…) is currently drawing on
    /// the alternate screen. Drives giving the whole pane to the terminal.
    @Published var inAltScreen: Bool = false
    /// The agent's latest completed message (markdown), read from its transcript
    /// while an agent session runs in this terminal. Rendered in the chat panel.
    @Published var assistantMessage: String?
    /// The previous turn's answer, pinned the moment a follow-up is sent so the
    /// chat keeps showing it (rather than blanking) while the agent works on the
    /// next reply. Only consulted by the UI during a working turn.
    @Published var priorAnswer: String?
    /// The latest user prompt (shown condensed at the top of the chat panel).
    @Published var userQuestion: String?
    /// Full Q&A history parsed from the transcript, oldest→newest. Powers the
    /// chat's back/forward navigation through past exchanges.
    @Published var exchanges: [AgentExchange] = []
    /// When the user has paged back, the index into `exchanges` being shown.
    /// nil = following the live/latest exchange (the default).
    @Published var historyIndex: Int?
    /// The agent is actively generating a reply (drives the tab working spinner).
    @Published var botWorking: Bool = false
    /// True from the instant a chat message is submitted until the agent visibly
    /// starts (`botWorking`) or its reply lands. Bridges the ~1s gap where the
    /// poll's `detectPrompt()` would otherwise recompute `botWorking = false`
    /// because the agent hasn't drawn its "esc to interrupt" marker yet — so the
    /// chat shows a solid "working" state the moment you hit send.
    @Published var awaitingReply: Bool = false
    /// When the current `awaitingReply` began — used for a safety long-stop so an
    /// aborted launch can't wedge the working banner on forever.
    private var pendingSince: Date?
    /// Which "working" critter to show — bumped once per submitted task so the
    /// animal is chosen at send and stays put for the whole turn (rather than
    /// changing as the transcript's exchange count ticks up mid-task).
    @Published var taskCritter: Int = 0
    /// A confirmation/choice prompt the agent is showing — answered from the chat UI.
    @Published var pendingPrompt: AgentPrompt?
    /// An interactive prompt is live on the terminal that we could NOT parse into
    /// answer buttons (an arrow-key menu, a trust dialog, a free-form confirm).
    /// These never reach the transcript, so without this flag the chat would
    /// keep showing the previous, now-stale answer. When set, the chat shows a
    /// "answer in the terminal" affordance instead of that stale message.
    @Published var liveInteractivePrompt: Bool = false
    /// High-level agent status shown as a tab tag (see `AgentStatus`). Driven by
    /// `detectPrompt`; cleared back to `.idle` from `.complete` once the tab is
    /// focused (acknowledged).
    @Published var agentStatus: AgentStatus = .idle
    /// False until the first `updateAgentStatus()` for this session, so a session
    /// that's *already* finished when the app launches/restores seeds its status
    /// silently instead of firing the "done" chime on startup.
    private var chimeSeeded = false
    /// The last completed reply the user has already looked at (set on focus).
    /// A finished, non-question reply shows `Complete` until it matches this —
    /// then it falls back to idle. Keyed to the message text so it survives the
    /// status being re-derived from scratch each poll.
    private var acknowledgedMessage: String?
    /// How many tokens this chat's agent conversation is currently carrying in
    /// context (from the transcript's latest usage). Drives the per-chat context
    /// readout in the rail. `nil` until the agent has written usage.
    @Published var contextTokens: Int?
    /// The context window that latest turn's model allows (200k, or 1M for a
    /// `[1m]` session) — the denominator for `contextFraction`.
    @Published var contextLimit: Int?
    /// The agent's live status line while working (e.g. "17m 43s · ↑ 31.9k tokens").
    @Published var workingStatus: String?
    /// The agent's current tip (e.g. "Use /btw to ask a quick side question…").
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
    /// The model label shown in the input toolbar (display only).
    @Published var modelLabel: String = "Auto"
    /// Thinking-effort label shown in the toolbar.
    @Published var effortLabel: String = "Standard"
    /// The thinking keyword prepended to messages ("", "think", "think hard",
    /// "ultrathink") to dial the agent's reasoning effort up.
    var effortKeyword: String = ""

    /// The adapter for the agent currently running in this terminal, if any.
    @Published var currentAgent: AgentAdapter?

    /// The binary name of an unrecognised agent that just launched, triggering the
    /// first-run setup handshake. Cleared when the user saves or skips.
    @Published var pendingAgentSetup: String?

    /// True when an agent CLI is the current foreground command.
    var isAgentRunning: Bool {
        guard let cmd = runningCommand?.lowercased() else { return false }
        if let agent = AgentRegistry.adapter(forCommand: cmd) {
            if currentAgent?.binaryName != agent.binaryName { currentAgent = agent }
            return true
        }
        return false
    }

    /// Detect a foreground command that looks like an agent CLI but isn't known.
    /// Runs on the status poll; when it fires, the workspace presents the setup sheet.
    private func checkForUnknownAgent() {
        guard currentAgent == nil, pendingAgentSetup == nil, !inAltScreen else { return }
        guard let cmd = runningCommand?.lowercased(), !cmd.isEmpty else { return }
        // Skip obvious non-agent commands and anything already covered by an adapter.
        let known = AgentRegistry.adapters.contains { $0.matches(command: cmd) }
        guard !known else { return }
        // Heuristic: an interactive TUI with no shell in the foreground is likely an agent.
        let looksLikeTUI = cmd.contains("agent") || cmd.contains("ai") || cmd.contains("llm")
            || cmd.contains("assistant") || cmd.contains("bot")
        guard looksLikeTUI else { return }
        pendingAgentSetup = cmd.components(separatedBy: " ").first ?? cmd
    }

    /// Mark the pending setup as handled (saved or skipped).
    func completeAgentSetup() {
        pendingAgentSetup = nil
    }

    /// Switch the running agent's model via its model-switch command, if it has one.
    func setModel(_ id: String, _ label: String) {
        modelLabel = label
        guard let cmd = currentAgent?.modelSwitchCommand, tuiActive else { return }
        sendLineToTUI("\(cmd) \(id)")
    }

    /// Send a line of input to the live TUI (agent CLI) as the pasted text
    /// followed by a SEPARATE Return a short beat later. Agent TUIs wrap
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

    /// Run a slash command in the running agent (or launch + run).
    func runCommand(_ slash: String) {
        submitInput(slash)
    }

    /// Transcript follow state. Reading/parsing happens on `transcriptQueue`
    /// (transcripts reach MBs — re-reading them on the main thread stalled the
    /// UI); `transcriptInFlight`/`transcriptGeneration` are main-thread only,
    /// the rest is `transcriptQueue`-only.
    private let transcriptQueue = DispatchQueue(label: "com.idealize.transcript")
    /// A poll is queued or running — polls never overlap (coalesced, 1 Hz max).
    private var transcriptInFlight = false
    /// Bumped per dispatched poll so a stale result can't land after a newer one.
    private var transcriptGeneration = 0
    private var bgTranscriptURL: URL?
    private var bgTranscriptMTime: Date?
    /// The transcript file this chat is following, mirrored onto the main thread
    /// (bg state is transcriptQueue-only). Backs `claudeSessionId` for resume.
    private var followedTranscriptURL: URL?
    /// Incremental parser for Claude transcripts (re-created if the URL changes).
    private var transcriptFollower: ClaudeTranscript.Follower?
    /// The session id we bound at launch, so we read exactly this terminal's
    /// transcript rather than the newest file in the project dir. nil when the
    /// agent was started by hand or doesn't support session binding.
    private var boundSessionId: String?

    /// Augment an agent launch with a fresh session id when the adapter supports
    /// it, so its transcript is identifiable. Returns the command unchanged for
    /// agents that don't bind sessions at launch.
    private func augmentAgentLaunch(_ command: String) -> String {
        guard let agent = AgentRegistry.adapter(forCommand: command.lowercased()) else { return command }
        // Only Claude currently supports launch-time session binding.
        guard agent.binaryName == "claude" else { return command }
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
    /// True whenever a TUI (agent CLI or another full-screen program) owns the pane.
    var tuiActive: Bool { inAltScreen || isAgentRunning }

    /// A Claude Code session is the current foreground command. Reliable even
    /// when Claude doesn't use the alternate screen / reports an odd proc name.
    var isClaudeRunning: Bool {
        guard let cmd = runningCommand?.lowercased() else { return false }
        return TerminalSession.isClaudeCommand(cmd)
    }

    /// Whether a command string invokes `claude` — bare, with args, after a
    /// separator (`&&`/`;`), or as a full path. Used by the persisted snapshot's
    /// `wasClaude` and the rail's restore affordances. (Agent detection proper
    /// lives in `AgentRegistry`; this is the launch-restore check.)
    static func isClaudeCommand(_ command: String) -> Bool {
        command.range(of: "(^|[ /&;])claude($| )", options: .regularExpression) != nil
    }
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
    /// Hatch to drop this tab straight into an agent dev session on IDEalize itself.
    var launchOverride: String?

    /// Force a plain shell: skip the auto-launch (e.g. `claude …`) even when the
    /// global default would run one. Set before `start()`. Used when restoring a
    /// chat that was a bare shell, so it doesn't get an unexpected agent on relaunch.
    var suppressAutoLaunch: Bool = false

    /// This tab was opened via the Service Hatch (an agent dev session on
    /// IDEalize's own source). Drives the themed opening banner in the chat.
    @Published var isServiceHatch: Bool = false

    /// This tab is the project's coordinating chat (opened via the toolbar's
    /// project-agent toggle). Other chats in the same project can reach it by
    /// the "coordinator" alias or `$IDEALIZE_PROJECT_AGENT`.
    @Published var isProjectAgent: Bool = false

    private let settings: AppSettings
    private var statusTimer: Timer?
    private weak var workspace: Workspace?

    init(settings: AppSettings, workspace: Workspace, projectPath: String? = nil) {
        // 8-hex ids collide only at ~65k sessions; still re-roll on the odd hit
        // against a live session.
        var candidate = TerminalSession.makeID()
        while workspace.session(withID: candidate) != nil {
            candidate = TerminalSession.makeID()
        }
        self.id = candidate
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
            if let cwd { adoptReportedCwd(cwd) }
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
    /// configured default launch command (e.g. an agent CLI).
    func start() {
        var env = Terminal.getEnvironmentVariables(termName: "xterm-256color")
        env.append("\(IPC.sessionEnvKey)=\(id)")
        env.append("IDEALIZE_SOCK=\(IPC.socketPath)")
        env.append("\(IPC.tokenEnvKey)=\(workspace?.ipcToken ?? "")")
        env.append("IDEALIZE=1")
        // A chat starting in an already-coordinated project gets the project
        // agent's id, so it can report to it directly
        // (`idealize send $IDEALIZE_PROJECT_AGENT …`). Chats started before the
        // project agent can still reach it via the "coordinator" alias.
        if let path = projectPath,
           let agent = workspace?.projectAgentSession(forProject: path),
           agent.id != id {
            env.append("IDEALIZE_PROJECT_AGENT=\(agent.id)")
        }
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
            agentLaunchInFlight = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.firePendingLaunch()
            }
        }
    }

    /// A launch command (e.g. an agent CLI) queued to run once the shell is ready.
    private var pendingLaunchCommand: String?
    /// True from when we queue/issue an agent launch until it becomes the
    /// foreground TUI (or the attempt is abandoned). The single coordination
    /// point between the auto-launch and a user's first message: while it's set,
    /// a first message is delivered to the coming agent rather than racing in a
    /// second launch — the double-launch that left two stillborn transcripts and
    /// bound the chat to the wrong one.
    private var agentLaunchInFlight = false
    /// Last time the agent's "working" marker was on screen (for the grace period).
    private var lastWorkingSeen: Date?

    private func firePendingLaunch() {
        guard let cmd = pendingLaunchCommand else { return }
        pendingLaunchCommand = nil
        agentLaunchInFlight = true
        terminalView.send(txt: "\u{15}" + augmentAgentLaunch(cmd) + "\n")   // Ctrl-U clears any partial line
    }

    func terminate() {
        statusTimer?.invalidate()
        statusTimer = nil
        removeScrollMonitor()
        terminalView.process.terminate()
    }

    /// Detach the trackpad scroll monitor. Called from both teardown paths:
    /// explicit `terminate()` and natural shell death (`processTerminated`) —
    /// the latter used to leak the monitor.
    private func removeScrollMonitor() {
        if let m = scrollMonitor { NSEvent.removeMonitor(m); scrollMonitor = nil }
    }

    // MARK: - Trackpad scroll fix

    private var scrollMonitor: Any?
    private var scrollAccumulator: CGFloat = 0

    /// SwiftTerm's `scrollWheel` reads only the legacy `event.deltaY`, which is 0
    /// for trackpad precise scrolling → two-finger scroll does nothing. It's not
    /// `open`, so we can't override it; instead a local monitor handles precise
    /// scroll over this terminal.
    ///
    /// Two cases: when a foreground TUI is tracking the mouse (agent CLI, vim,
    /// less, htop — all of which enable mouse reporting and run on the alternate
    /// screen), we forward the wheel as mouse-wheel events so the app scrolls its
    /// own viewport. The alt screen has no scrollback, so SwiftTerm's own
    /// `scrollUp/Down` would move nothing — which is exactly why scrolling looked
    /// dead inside the agent. Otherwise (a plain shell), we drive SwiftTerm's
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
        // Prefer the transcript actually being followed: after a stillborn
        // `--session-id` launch the adapter follows the newest real transcript,
        // and resuming the dead bound id would lose the conversation.
        followedTranscriptURL?.deletingPathExtension().lastPathComponent ?? boundSessionId
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

        // An auto-launched agent with no queued message has no waiter to clear
        // the in-flight flag — release it here once the agent owns the pane.
        if agentLaunchInFlight && tuiActive { agentLaunchInFlight = false }

        checkForUnknownAgent()
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

    /// Detect an agent confirmation/choice prompt on screen so the chat UI can
    /// offer answer buttons; also lift the agent's status line + tip.
    private func detectPrompt() {
        guard isAgentRunning || inAltScreen else {
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
        let agent = currentAgent ?? GenericAgentAdapter()
        let prompt = agent.parsePrompt(lines: lines)
        if prompt != pendingPrompt {
            pendingPrompt = prompt
            // Surface the question even if the modal was minimised.
            if prompt != nil { chatMinimised = false }
        }
        // The agent is actively generating while its working status is on screen.
        // Markers flicker between spinner frames / tool calls, so once seen we
        // keep "working" for a short grace period to avoid the animation
        // dropping back to the last message mid-task. The marker disappearing
        // for >1.5s (agent idle at its prompt) ends it — no permanent stuck.
        let workingState = agent.detectWorkingState(lines: lines)
        if workingState.isWorking { lastWorkingSeen = Date() }
        let recentlyWorking = lastWorkingSeen.map { Date().timeIntervalSince($0) < 1.5 } ?? false
        let working = prompt == nil && (workingState.isWorking || recentlyWorking)
        if working != botWorking { botWorking = working }
        // The submit-time `awaitingReply` banner hands off the moment the agent
        // visibly starts (its marker → `working`) or puts up a prompt; a launch
        // that stalls clears after a grace period so it can't wedge on forever.
        if awaitingReply {
            if working || pendingPrompt != nil || liveInteractivePrompt {
                awaitingReply = false
            } else if let since = pendingSince, Date().timeIntervalSince(since) > 90 {
                awaitingReply = false
            }
        }
        if workingState.status != workingStatus { workingStatus = workingState.status }
        if workingState.tip != workingTip { workingTip = workingState.tip }
        // An interactive prompt we couldn't structure into buttons (arrow-key
        // menu, trust dialog, free-form confirm). Look only at the bottom of the
        // screen, where the agent renders its prompt footers, so prose in a finished
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
    /// Stateless — derived fresh each poll from what's on screen and the agent's
    /// last reply, so it lands correctly even on a freshly relaunched app with an
    /// agent session already sitting idle (no need to have witnessed the
    /// working→idle transition).
    private func updateAgentStatus() {
        let next: AgentStatus
        if pendingPrompt != nil || liveInteractivePrompt {
            next = .waiting                  // a choice box / live prompt is up
        } else if botWorking {
            next = .working
        } else if let msg = assistantMessage, !msg.isEmpty {
            // The agent is idle at its prompt with a completed reply on the table.
            // Agents often ask their question in prose ("Want me to…?"), so any
            // question mark in the reply means Waiting; an answered-or-statement
            // reply is Complete until the tab is focused (then it's idle).
            if messageContainsQuestion(msg) {
                next = .waiting
            } else {
                next = (msg == acknowledgedMessage) ? .idle : .complete
            }
        } else {
            next = .idle
        }
        let previous = agentStatus
        agentStatus = next

        // The "done" chime: fire on the very transition that lights up the chat
        // notification — entering an attention state (a response is ready:
        // `.complete` or `.waiting`) from a non-attention one (`.idle`/`.working`).
        // No dependency on having witnessed `.working`, which the poll can miss.
        // The one-time seed swallows a session that's already finished at launch,
        // so restoring the app doesn't chime for every completed tab.
        let wasAttention = (previous == .complete || previous == .waiting)
        let isAttention = (next == .complete || next == .waiting)
        if !chimeSeeded {
            chimeSeeded = true
        } else if isAttention && !wasAttention {
            DoneSound.play()
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

    /// Answer a detected prompt by pressing the option's number in the agent.
    func answerPrompt(_ option: AgentPrompt.Option) {
        terminalView.send(txt: "\(option.number)")
        pendingPrompt = nil
        botWorking = true
        agentStatus = .working
    }

    /// Toggle a checkbox option in a multi-select prompt (sends its number to
    /// flip it). Keeps the prompt open so the screen re-parses the new state.
    func togglePromptOption(_ option: AgentPrompt.Option) {
        terminalView.send(txt: "\(option.number)")
    }

    /// Confirm a multi-select prompt (Enter), proceeding with the current ticks.
    func confirmPrompt() {
        terminalView.send(txt: "\r")
        pendingPrompt = nil
        botWorking = true
        agentStatus = .working
    }

    /// Cancel the prompt the agent is currently working on. Sends ESC — the key
    /// the agent's TUI itself advertises ("esc to interrupt") — to stop it mid-turn.
    func interrupt() {
        guard tuiActive else { return }
        terminalView.send(txt: "\u{1b}")   // ESC
        pendingPrompt = nil
        // Reflect the stop immediately; the on-screen marker poll keeps it honest.
        botWorking = false
        agentStatus = .idle
    }

    /// While an agent session is running here, pull its latest completed message
    /// from its transcript. The directory scan, stat and JSONL parsing all run
    /// on `transcriptQueue`; only the parsed exchanges hop back to the main
    /// thread. Polls are serialized via `transcriptInFlight` and stale results
    /// are dropped via `transcriptGeneration`.
    private func refreshAssistantMessage() {
        guard let cwd = projectPath, !cwd.isEmpty else { return }
        guard isAgentRunning || inAltScreen else { return }
        guard let agent = currentAgent else { return }
        guard !transcriptInFlight else { return }
        transcriptInFlight = true
        transcriptGeneration += 1
        let generation = transcriptGeneration
        let sessionId = boundSessionId
        transcriptQueue.async { [weak self] in
            guard let self else { return }
            var parsed: [AgentExchange]?
            var usage: ClaudeTranscript.ContextUsage?
            var changedURL: URL?
            if let url = agent.transcriptURL(forCwd: cwd, sessionId: sessionId) {
                // Same debounce as before: only re-read when the file changes.
                let mtime = (try? FileManager.default
                    .attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? .distantPast
                if url != self.bgTranscriptURL || mtime != self.bgTranscriptMTime {
                    self.bgTranscriptURL = url
                    self.bgTranscriptMTime = mtime
                    changedURL = url
                    if agent.binaryName == "claude" {
                        // Incremental: parse only bytes appended since the last
                        // poll; the follower merges the new tail itself.
                        if self.transcriptFollower?.url != url {
                            self.transcriptFollower = ClaudeTranscript.Follower(url: url)
                        }
                        if let follower = self.transcriptFollower, follower.poll() {
                            parsed = follower.exchanges
                        }
                        // The context-gauge readout (tokens carried vs the model's
                        // window) rides the same change tick, off the main thread.
                        usage = ClaudeTranscript.contextUsage(in: url)
                    } else {
                        parsed = agent.allExchanges(in: url)
                    }
                }
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.transcriptInFlight = false
                if let changedURL { self.followedTranscriptURL = changedURL }
                guard self.transcriptGeneration == generation else { return }
                // Apply the context gauge before the exchange guards: tool-only
                // appends grow token usage without changing the visible Q&A, and
                // the mtime debounce means this tick is the only chance to show it.
                if let usage {
                    if usage.tokens != self.contextTokens { self.contextTokens = usage.tokens }
                    if usage.limit != self.contextLimit { self.contextLimit = usage.limit }
                }
                guard let all = parsed else { return }
                // Transcripts are append-only, so count + last exchange decide
                // whether anything changed — no deep compare of unchanged history.
                guard all.count != self.exchanges.count || all.last != self.exchanges.last else { return }
                self.exchanges = all
                let q = all.last?.question
                let a = all.last?.answer
                // Assign even when nil: switching to a fresh (empty) session
                // must clear the previous session's question, or the panel
                // keeps showing a bubble from a chat that's no longer followed.
                if q != self.userQuestion { self.userQuestion = q }
                if a != self.assistantMessage {
                    self.assistantMessage = a
                    // A real reply landed — the submit-time working banner can stand down.
                    if self.awaitingReply, let a, !a.isEmpty { self.awaitingReply = false }
                }
                // NB: botWorking is driven by the on-screen "working" marker in
                // detectPrompt(), not the transcript — the transcript heuristic got stuck.
            }
        }
    }

    /// Send a line of input: to the running TUI (e.g. an agent CLI) on the
    /// alternate screen, or to the shell prompt otherwise.
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
            // Talking to a running agent (or other TUI): show the new question but
            // keep the previous answer pinned (in `priorAnswer`) so the chat doesn't
            // blank out while the agent works — `assistantMessage` then updates live
            // to the new turn's narration as the transcript records it.
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            if pendingPrompt != nil {
                // The agent is showing a selection prompt (numbered menu). Typing
                // a fresh instruction into that menu gets swallowed — the menu
                // reads it as a filter/selection — so the message silently
                // vanished. Exit the menu first (ESC), then deliver the text to
                // the clean input line a beat later so it registers as a message.
                pendingPrompt = nil
                terminalView.send(txt: "\u{1b}")   // ESC — leave the menu
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                    self?.sendLineToTUI(text)
                }
            } else {
                sendLineToTUI(text)
            }
        } else if agentLaunchInFlight {
            // A launch we already issued (auto-launch, or an earlier message) is
            // still coming up. Deliver to it — never start a second agent, which
            // would race two sessions and bind the chat to a stillborn one.
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            firePendingLaunch()   // no-op if the queued auto-launch already fired
            waitForAgentThenSend(text, attemptsLeft: 30)
        } else if blocks.isEmpty {
            // Fresh terminal — treat the first input as a chat: launch the agent,
            // then deliver the message once it's ready. Only when the user has
            // opted into auto-launch; otherwise run it as a plain shell command.
            guard settings.launchOnNewTerminal else {
                rerun(text)
                return
            }
            priorAnswer = assistantMessage
            userQuestion = text
            botWorking = true
            awaitingReply = true
            pendingSince = Date()
            taskCritter += 1
            agentStatus = .working
            agentLaunchInFlight = true
            let launch = settings.defaultLaunchCommand.trimmingCharacters(in: .whitespacesAndNewlines)
            let cmd = launch.isEmpty ? "claude --dangerously-skip-permissions" : launch
            terminalView.send(txt: "\u{15}" + augmentAgentLaunch(cmd) + "\n")
            waitForAgentThenSend(text, attemptsLeft: 30)
        } else {
            // The shell is in use (e.g. after exiting the agent) — run as a normal
            // shell command. Type the agent's command to start a new chat. We do
            // NOT auto-relaunch the agent here.
            rerun(text)
        }
    }

    /// Poll until the agent has taken over (alt-screen / running), then deliver the
    /// queued first message. Stops if the agent never appears.
    private func waitForAgentThenSend(_ text: String, attemptsLeft: Int) {
        guard attemptsLeft > 0 else {
            agentLaunchInFlight = false   // gave up — let a later message relaunch
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            if self.tuiActive {
                self.agentLaunchInFlight = false   // the agent is up; it owns the pane now
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.sendLineToTUI(text)
                }
            } else {
                self.waitForAgentThenSend(text, attemptsLeft: attemptsLeft - 1)
            }
        }
    }

    // MARK: - Helpers

    private static func makeID() -> String {
        // Short, human-typeable id (e.g. "t-4f7a2b9c").
        let uuid = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        return "t-" + String(uuid.prefix(8))
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
        if let dir = directory { adoptReportedCwd(dir) }
    }

    /// Adopt a shell-reported working directory (OSC 1771 prompt event or OSC 7)
    /// only if it's trustworthy enough to feed `reveal` authorization: `file://`
    /// URLs are properly percent-decoded, the path must exist and be a directory,
    /// and "/" is never accepted. Anything failing that is ignored, so a forged
    /// OSC sequence can't rewrite `projectPath`.
    private func adoptReportedCwd(_ raw: String) {
        var path = raw
        if path.hasPrefix("file://") {
            // URL parsing percent-decodes (%20 etc.) — the old string-replace
            // left escapes in place, breaking paths with spaces.
            guard let url = URL(string: path), url.isFileURL else { return }
            path = url.path(percentEncoded: false)
        }
        let standardized = (path as NSString).standardizingPath
        guard standardized != "/", !standardized.isEmpty else { return }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: standardized, isDirectory: &isDir),
              isDir.boolValue else { return }
        projectPath = standardized
    }

    func processTerminated(source: TerminalView, exitCode: Int32?) {
        isRunning = false
        agentLaunchInFlight = false
        statusTimer?.invalidate()
        statusTimer = nil
        removeScrollMonitor()
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
