import SwiftUI
import AppKit

/// Factory values for the scalar appearance settings, so the Appearance panel's
/// per-section "Reset" can put a section back exactly as it shipped. Kept here
/// (rather than as literals in `init`) so the default and the reset can never
/// drift apart.
enum AppearanceDefaults {
    // Interface
    static let uiFontName = ""          // "" == San Francisco
    static let uiFontSize = 13.0
    // Terminal
    static let fontName = "DM Mono"
    static let fontSize = 14.0
    static let terminalMargin = 36.0
    static let terminalLineSpacing = 1.0
    static var terminalThemeName: String { Theme.linen.name }
    // Chat
    static let chatInputOpacity = 1.0
    static let chatInputLineSpacing = 2.0
    static let chatShadowOpacity = 0.4
    static let chatMargin = 18.0
    static let terminalBlur = 3.0       // the terminal backdrop behind chat
    static let returnToSend = true
}

/// Order of the main window's columns.
enum WorkspaceLayout: String, CaseIterable, Identifiable {
    /// Files and documents on the left, terminal on the right (the classic IDE shape).
    case standard
    /// Terminal front and centre next to the sessions rail; documents open to its
    /// right, with the files panel on the far right.
    case chatFocused
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .standard: return "Standard"
        case .chatFocused: return "Chat-focused"
        }
    }
}

/// User-facing, persisted preferences. Backed by UserDefaults.
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    private let defaults = UserDefaults.standard

    // MARK: Typography
    /// The terminal / monospace font (terminal grid + captured command output).
    @Published var fontName: String {
        didSet { defaults.set(fontName, forKey: "fontName") }
    }
    @Published var fontSize: Double {
        didSet { defaults.set(fontSize, forKey: "fontSize") }
    }
    /// The interface (proportional) font used for all app chrome: tabs, block
    /// headers, the command bar, sidebar, labels. Empty string == San Francisco
    /// (the macOS system font). This is the "proper typography" surface — it is
    /// deliberately NOT locked to monospace.
    @Published var uiFontName: String {
        didSet { defaults.set(uiFontName, forKey: "uiFontName") }
    }
    /// Base size for interface text (scales all chrome proportionally; 13 = default).
    @Published var uiFontSize: Double {
        didSet { defaults.set(uiFontSize, forKey: "uiFontSize") }
    }
    /// Base text size for the agent chat answer panel (proportional). Larger
    /// than the terminal by default since it's the primary reading surface.
    @Published var chatFontSize: Double {
        didSet { defaults.set(chatFontSize, forKey: "chatFontSize") }
    }
    /// Line spacing between paragraphs/lines in the chat answer.
    @Published var chatLineSpacing: Double {
        didSet { defaults.set(chatLineSpacing, forKey: "chatLineSpacing") }
    }
    /// Opacity of the chat input lozenge (separate from the modal card).
    @Published var chatInputOpacity: Double {
        didSet { defaults.set(chatInputOpacity, forKey: "chatInputOpacity") }
    }
    /// Line spacing for the chat INPUT field only (independent of the chat
    /// answer/modal line spacing).
    @Published var chatInputLineSpacing: Double {
        didSet { defaults.set(chatInputLineSpacing, forKey: "chatInputLineSpacing") }
    }
    /// Opacity of the docked chat card's drop shadow.
    @Published var chatShadowOpacity: Double {
        didSet { defaults.set(chatShadowOpacity, forKey: "chatShadowOpacity") }
    }
    /// Gaussian blur radius applied to the terminal backdrop in chat mode.
    /// (Edited in Appearance ▸ Chat, since that is the only mode it is visible in.)
    @Published var terminalBlur: Double {
        didSet { defaults.set(terminalBlur, forKey: "terminalBlur") }
    }
    /// Left/right inset (points) between the terminal grid and the pane edges.
    /// The gap is painted with the terminal's own background so it reads as
    /// breathing room around the text. 0 = flush to the edges.
    @Published var terminalMargin: Double {
        didSet { defaults.set(terminalMargin, forKey: "terminalMargin") }
    }
    /// Terminal line spacing as a multiple of the font's natural line height
    /// (1 = tight/default).
    @Published var terminalLineSpacing: Double {
        didSet { defaults.set(terminalLineSpacing, forKey: "terminalLineSpacing") }
    }
    /// The colour scheme for the terminal grid alone — independent of the app
    /// theme, so a warm paper terminal can sit inside a differently-themed app.
    @Published var terminalThemeName: String {
        didSet { defaults.set(terminalThemeName, forKey: "terminalThemeName") }
    }
    /// Inner padding (margins) of the chat modal.
    @Published var chatMargin: Double {
        didSet { defaults.set(chatMargin, forKey: "chatMargin") }
    }
    /// Whether Return sends the chat message (off → Return inserts a newline; ⌘↩ sends).
    @Published var returnToSend: Bool {
        didSet { defaults.set(returnToSend, forKey: "returnToSend") }
    }
    /// Whether releasing the dictation key/button auto-sends the captured speech.
    @Published var voiceReleaseToSend: Bool {
        didSet { defaults.set(voiceReleaseToSend, forKey: "voiceReleaseToSend") }
    }

    // MARK: Theme
    @Published var themeName: String {
        didSet { defaults.set(themeName, forKey: "themeName") }
    }
    var theme: Theme { Theme.named(themeName) }
    /// The terminal grid's own colour scheme.
    var terminalTheme: Theme { Theme.named(terminalThemeName) }

    // MARK: Per-panel appearance (the USP)
    /// Typography + background overrides keyed by `PanelKind.rawValue`.
    @Published var panelAppearances: [String: PanelAppearance] {
        didSet { scheduleAppearancePersist() }
    }
    /// Global action colour for primary buttons + selected-panel highlight.
    @Published var actionAppearance: ActionAppearance {
        didSet { scheduleAppearancePersist() }
    }

    /// Persisting these JSON-encodes on every change, and a colour drag in the
    /// Appearance inspector fires a change per tick — so coalesce rapid edits
    /// into one write a beat after the last change (the same debounce FlowStore
    /// uses for flow.json). Scalar settings keep their immediate didSet writes.
    private var appearancePersistTask: Task<Void, Never>?

    private func scheduleAppearancePersist() {
        appearancePersistTask?.cancel()
        let panels = panelAppearances
        let action = actionAppearance
        appearancePersistTask = Task { [defaults] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            if let d = try? JSONEncoder().encode(panels) {
                defaults.set(d, forKey: "panelAppearances")
            }
            if let d = try? JSONEncoder().encode(action) {
                defaults.set(d, forKey: "actionAppearance")
            }
        }
    }

    func appearance(_ kind: PanelKind) -> PanelAppearance {
        panelAppearances[kind.rawValue] ?? .empty
    }

    func setAppearance(_ a: PanelAppearance, for kind: PanelKind) {
        panelAppearances[kind.rawValue] = a
    }

    /// A resolved style for a panel, layered over the active theme.
    func panelStyle(_ kind: PanelKind, base: CGFloat, background: NSColor) -> PanelStyle {
        PanelStyle(appearance: appearance(kind), theme: theme, settings: self,
                   baseSize: base, defaultBackground: background)
    }

    var actionStyle: ActionStyle {
        ActionStyle(appearance: actionAppearance, theme: theme)
    }

    // MARK: Default launch behavior
    /// If set, this command is run automatically when a new terminal opens.
    @Published var defaultLaunchCommand: String {
        didSet { defaults.set(defaultLaunchCommand, forKey: "defaultLaunchCommand") }
    }
    /// Whether the default launch command runs on new terminals.
    @Published var launchOnNewTerminal: Bool {
        didSet { defaults.set(launchOnNewTerminal, forKey: "launchOnNewTerminal") }
    }
    /// The login shell to spawn.
    @Published var shellPath: String {
        didSet { defaults.set(shellPath, forKey: "shellPath") }
    }
    /// Path to IDEalize's own source checkout, used by the Service hatch to root
    /// its dev session. Empty until the user points at it: an installed `.app`
    /// (in `/Applications`) has no path relationship to the source, so it can't be
    /// inferred. See `ServiceHatch.repoRoot()`.
    @Published var serviceHatchRepoPath: String {
        didSet { defaults.set(serviceHatchRepoPath, forKey: "serviceHatchRepoPath") }
    }

    // MARK: Project agent
    /// Open a project's coordinating agent automatically once that project has a
    /// second chat, instead of offering it in a sheet. The sidebar's own button
    /// stays available from the very first chat either way, so this is "stop
    /// asking me", not "start earlier".
    @Published var projectAgentAutoStart: Bool {
        didSet { defaults.set(projectAgentAutoStart, forKey: "projectAgentAutoStart") }
    }
    /// Model the coordinating agent runs on, appended as `--model <value>`. Empty
    /// inherits whatever the launch command already selects. The coordinator does
    /// a simpler job than the chats it manages so it can run cheaper — but it also
    /// *reads* the most (every chat's transcript, plus `idealize survey`), so a
    /// small context window bites sooner here than it would in a worker.
    @Published var projectAgentModel: String {
        didSet { defaults.set(projectAgentModel, forKey: "projectAgentModel") }
    }
    /// Model the chats the coordinator spawns run on. Kept separate from
    /// `projectAgentModel` so choosing a cheap coordinator doesn't quietly
    /// downgrade the chats doing the actual building.
    @Published var projectAgentChildModel: String {
        didSet { defaults.set(projectAgentChildModel, forKey: "projectAgentChildModel") }
    }
    /// A different agent command for the coordinator alone. Empty inherits
    /// `defaultLaunchCommand`. A non-Claude command takes neither `--model` nor
    /// `--append-system-prompt`, so with one set the guide arrives only as the
    /// `/project-agent` opening turn.
    @Published var projectAgentLaunchCommand: String {
        didSet { defaults.set(projectAgentLaunchCommand, forKey: "projectAgentLaunchCommand") }
    }
    /// The `FlowSkillInstaller.version` the user's edited operating prompt was
    /// seeded from, so we can tell them when the built-in guide has moved on
    /// *without* touching their copy. 0 = they have never edited it.
    @Published var projectAgentPromptBaseVersion: Int {
        didSet { defaults.set(projectAgentPromptBaseVersion, forKey: "projectAgentPromptBaseVersion") }
    }

    // MARK: Behavior
    @Published var notificationsEnabled: Bool {
        didSet { defaults.set(notificationsEnabled, forKey: "notificationsEnabled") }
    }
    /// Whether to play the "task complete" chime when Claude signals it's done.
    @Published var completionSoundEnabled: Bool {
        didSet { defaults.set(completionSoundEnabled, forKey: "completionSoundEnabled") }
    }
    /// Volume of the completion chime, 0…1. Gentle by default.
    @Published var completionSoundVolume: Double {
        didSet { defaults.set(completionSoundVolume, forKey: "completionSoundVolume") }
    }
    /// False until the user dismisses the first-run welcome / sends a first message.
    @Published var hasSeenWelcome: Bool {
        didSet { defaults.set(hasSeenWelcome, forKey: "hasSeenWelcome") }
    }
    /// False until the first-run showcase has been run or skipped. Separate from
    /// `hasSeenWelcome`: the welcome card greets you, the tour shows you the room.
    @Published var hasSeenTour: Bool {
        didSet { defaults.set(hasSeenTour, forKey: "hasSeenTour") }
    }
    /// The id of the most recent announcement the user has dismissed. Empty until
    /// they close their first one. Used to show each announcement banner once.
    @Published var lastSeenAnnouncementID: String {
        didSet { defaults.set(lastSeenAnnouncementID, forKey: "lastSeenAnnouncementID") }
    }
    /// Recently opened folders (most-recent first) for the File ▸ Open Recent menu.
    @Published var recentFolders: [String] {
        didSet { defaults.set(recentFolders, forKey: "recentFolders") }
    }

    // MARK: Screen layout
    /// Order of the main window's columns (standard vs chat-focused).
    @Published var workspaceLayout: WorkspaceLayout {
        didSet { defaults.set(workspaceLayout.rawValue, forKey: "workspaceLayout") }
    }

    // MARK: Mini Mode
    /// Whether the app is currently in the narrow docked mini-mode.
    @Published var miniModeEnabled: Bool {
        didSet { defaults.set(miniModeEnabled, forKey: "miniModeEnabled") }
    }
    /// Which screen edge the mini-mode column docks to.
    @Published var miniModeDockSide: DockSide {
        didSet { defaults.set(miniModeDockSide.rawValue, forKey: "miniModeDockSide") }
    }
    /// Keep the mini-mode window floating above other apps.
    @Published var miniModeAlwaysOnTop: Bool {
        didSet { defaults.set(miniModeAlwaysOnTop, forKey: "miniModeAlwaysOnTop") }
    }
    /// The window frame captured before entering mini-mode, used to restore on exit.
    var miniModePreFrame: NSRect? {
        get {
            guard let d = defaults.dictionary(forKey: "miniModePreFrame") as? [String: Double],
                  let x = d["x"], let y = d["y"],
                  let width = d["width"], let height = d["height"] else { return nil }
            return NSRect(x: x, y: y, width: width, height: height)
        }
        set {
            if let r = newValue {
                defaults.set(["x": r.minX, "y": r.minY, "width": r.width, "height": r.height],
                             forKey: "miniModePreFrame")
            } else {
                defaults.removeObject(forKey: "miniModePreFrame")
            }
        }
    }
    /// Whether the window was zoomed (green-button maximised) before mini-mode.
    var miniModePreZoomed: Bool {
        get { defaults.object(forKey: "miniModePreZoomed") as? Bool ?? false }
        set { defaults.set(newValue, forKey: "miniModePreZoomed") }
    }
    /// Whether the window was in native full-screen before mini-mode, so exiting
    /// mini-mode returns to full-screen rather than a windowed frame.
    var miniModePreFullScreen: Bool {
        get { defaults.object(forKey: "miniModePreFullScreen") as? Bool ?? false }
        set { defaults.set(newValue, forKey: "miniModePreFullScreen") }
    }

    /// Snapshot of the session rail (Projects → Chats) for restore-on-launch.
    @Published var projectSnapshot: [PersistedProject] {
        didSet {
            if let data = try? JSONEncoder().encode(projectSnapshot) {
                defaults.set(data, forKey: "projectSnapshot")
            }
        }
    }

    /// Project folders whose rail group is collapsed (persisted so it survives
    /// relaunch). Stored as paths.
    @Published var collapsedProjects: [String] {
        didSet { defaults.set(collapsedProjects, forKey: "collapsedProjects") }
    }

    /// Chats the user has archived (across every project). Kept out of
    /// `projectSnapshot` so archiving never affects restore-on-launch of the live
    /// chats. Viewed and reopened from the Archived Chats list.
    @Published var archivedChats: [ArchivedChat] {
        didSet {
            if let data = try? JSONEncoder().encode(archivedChats) {
                defaults.set(data, forKey: "archivedChats")
            }
        }
    }

    // Panel widths / the browse pane height live in `PanelLayout` — a drag
    // rewrites them per mouse event, and publishing that from here would
    // re-render every view that observes these settings.

    // MARK: Browse pane state, remembered per project
    /// project folder → the folder the browse pane was last pointed at.
    @Published var browseFolders: [String: String] {
        didSet { defaults.set(browseFolders, forKey: "browseFolders") }
    }
    /// project folder → whether the browse pane was left open.
    @Published var browseOpen: [String: Bool] {
        didSet { defaults.set(browseOpen, forKey: "browseOpen") }
    }

    /// The folder the browse pane should show for `project` — the one it was left
    /// on, falling back to the home directory.
    func browseFolder(for project: String) -> String {
        if let p = browseFolders[project], FileManager.default.fileExists(atPath: p) { return p }
        return FileManager.default.homeDirectoryForCurrentUser.path
    }

    func isBrowseOpen(for project: String) -> Bool { browseOpen[project] ?? false }

    func addRecentFolder(_ path: String) {
        guard !path.isEmpty, path != "/" else { return }
        var list = recentFolders.filter { $0 != path }
        list.insert(path, at: 0)
        recentFolders = Array(list.prefix(10))
    }

    private init() {
        Self.seedDevDefaultsFromInstalledAppIfNeeded()
        // Default terminal typeface is the bundled DM Mono (registered at launch).
        self.fontName = defaults.string(forKey: "fontName") ?? AppearanceDefaults.fontName
        self.fontSize = defaults.object(forKey: "fontSize") as? Double ?? AppearanceDefaults.fontSize
        self.uiFontName = defaults.string(forKey: "uiFontName") ?? AppearanceDefaults.uiFontName
        self.uiFontSize = defaults.object(forKey: "uiFontSize") as? Double ?? AppearanceDefaults.uiFontSize
        self.chatFontSize = defaults.object(forKey: "chatFontSize") as? Double ?? 16.0
        self.chatLineSpacing = defaults.object(forKey: "chatLineSpacing") as? Double ?? 5.0
        self.chatInputOpacity = defaults.object(forKey: "chatInputOpacity") as? Double ?? AppearanceDefaults.chatInputOpacity
        self.chatInputLineSpacing = defaults.object(forKey: "chatInputLineSpacing") as? Double ?? AppearanceDefaults.chatInputLineSpacing
        self.chatShadowOpacity = defaults.object(forKey: "chatShadowOpacity") as? Double ?? AppearanceDefaults.chatShadowOpacity
        self.terminalBlur = defaults.object(forKey: "terminalBlur") as? Double ?? AppearanceDefaults.terminalBlur
        self.terminalMargin = defaults.object(forKey: "terminalMargin") as? Double ?? AppearanceDefaults.terminalMargin
        self.terminalLineSpacing = defaults.object(forKey: "terminalLineSpacing") as? Double ?? AppearanceDefaults.terminalLineSpacing
        self.terminalThemeName = defaults.string(forKey: "terminalThemeName") ?? AppearanceDefaults.terminalThemeName
        self.chatMargin = defaults.object(forKey: "chatMargin") as? Double ?? AppearanceDefaults.chatMargin
        self.returnToSend = defaults.object(forKey: "returnToSend") as? Bool ?? AppearanceDefaults.returnToSend
        self.voiceReleaseToSend = defaults.object(forKey: "voiceReleaseToSend") as? Bool ?? false
        // Ink/Linen are terminal-only schemes. If one was previously picked as the
        // *app* theme it's no longer in the picker, so migrate it to the app theme
        // of matching brightness rather than leaving the window on a theme the
        // user can't see selected (or change back to).
        let storedTheme = defaults.string(forKey: "themeName") ?? Theme.idealizeDark.name
        if Theme.all.contains(where: { $0.name == storedTheme }) {
            self.themeName = storedTheme
        } else {
            self.themeName = Theme.named(storedTheme).isDark ? Theme.idealizeDark.name : Theme.idealizeLight.name
        }
        self.defaultLaunchCommand = defaults.string(forKey: "defaultLaunchCommand")
            ?? "claude --dangerously-skip-permissions"
        // Opt-in: auto-launching an agent (with permissions skipped) on every new
        // terminal is off unless the user flips the switch.
        self.launchOnNewTerminal = defaults.object(forKey: "launchOnNewTerminal") as? Bool ?? false
        self.shellPath = defaults.string(forKey: "shellPath")
            ?? (ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
        self.serviceHatchRepoPath = defaults.string(forKey: "serviceHatchRepoPath") ?? ""
        // Opt-in, and every model choice inherits by default: a coordinator should
        // behave exactly as it does today until the user says otherwise.
        self.projectAgentAutoStart = defaults.object(forKey: "projectAgentAutoStart") as? Bool ?? false
        self.projectAgentModel = defaults.string(forKey: "projectAgentModel") ?? ""
        self.projectAgentChildModel = defaults.string(forKey: "projectAgentChildModel") ?? ""
        self.projectAgentLaunchCommand = defaults.string(forKey: "projectAgentLaunchCommand") ?? ""
        self.projectAgentPromptBaseVersion =
            defaults.object(forKey: "projectAgentPromptBaseVersion") as? Int ?? 0
        self.notificationsEnabled = defaults.object(forKey: "notificationsEnabled") as? Bool ?? true
        self.completionSoundEnabled = defaults.object(forKey: "completionSoundEnabled") as? Bool ?? true
        self.completionSoundVolume = defaults.object(forKey: "completionSoundVolume") as? Double ?? 0.4
        self.hasSeenWelcome = defaults.object(forKey: "hasSeenWelcome") as? Bool ?? false
        self.hasSeenTour = defaults.object(forKey: "hasSeenTour") as? Bool ?? false
        self.lastSeenAnnouncementID = defaults.string(forKey: "lastSeenAnnouncementID") ?? ""
        self.recentFolders = defaults.stringArray(forKey: "recentFolders") ?? []
        self.workspaceLayout = WorkspaceLayout(rawValue: defaults.string(forKey: "workspaceLayout") ?? "") ?? .standard
        self.miniModeEnabled = defaults.object(forKey: "miniModeEnabled") as? Bool ?? false
        self.miniModeDockSide = DockSide(rawValue: defaults.string(forKey: "miniModeDockSide") ?? "") ?? .right
        self.miniModeAlwaysOnTop = defaults.object(forKey: "miniModeAlwaysOnTop") as? Bool ?? true
        self.projectSnapshot = (defaults.data(forKey: "projectSnapshot")
            .flatMap { try? JSONDecoder().decode([PersistedProject].self, from: $0) }) ?? []
        self.collapsedProjects = defaults.stringArray(forKey: "collapsedProjects") ?? []
        self.archivedChats = (defaults.data(forKey: "archivedChats")
            .flatMap { try? JSONDecoder().decode([ArchivedChat].self, from: $0) }) ?? []
        self.browseFolders = defaults.dictionary(forKey: "browseFolders") as? [String: String] ?? [:]
        self.browseOpen = defaults.dictionary(forKey: "browseOpen") as? [String: Bool] ?? [:]
        self.panelAppearances = (defaults.data(forKey: "panelAppearances")
            .flatMap { try? JSONDecoder().decode([String: PanelAppearance].self, from: $0) }) ?? [:]
        self.actionAppearance = (defaults.data(forKey: "actionAppearance")
            .flatMap { try? JSONDecoder().decode(ActionAppearance.self, from: $0) }) ?? .empty
    }

    /// The dev build has its own preferences domain, so it starts with none of
    /// the user's real settings — a fresh theme, no auto-launch, no projects. On
    /// its first run, copy the installed app's domain across so the test build
    /// feels like their app. The design-test keys below are deliberately left
    /// out, so the redesign's own defaults (DM Mono, margins, line spacing) win.
    private static func seedDevDefaultsFromInstalledAppIfNeeded() {
        let defaults = UserDefaults.standard
        guard Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true,
              !defaults.bool(forKey: "devSeededFromMainApp"),
              let installed = defaults.persistentDomain(forName: "com.idealize.terminal")
        else { return }
        let designKeys: Set<String> = ["fontName", "fontSize", "terminalMargin",
                                       "terminalLineSpacing", "terminalThemeName"]
        for (key, value) in installed where !designKeys.contains(key) {
            defaults.set(value, forKey: key)
        }
        // Drop any per-panel *terminal* override that came across: the terminal is
        // configured by its own theme now, and a copied solid-black background
        // would silently win over it.
        if let data = defaults.data(forKey: "panelAppearances"),
           var panels = try? JSONDecoder().decode([String: PanelAppearance].self, from: data),
           panels.removeValue(forKey: PanelKind.terminal.rawValue) != nil,
           let trimmed = try? JSONEncoder().encode(panels) {
            defaults.set(trimmed, forKey: "panelAppearances")
        }
        // Drop any design keys this build wrote on an earlier dev run, so the new
        // defaults apply rather than a stale value.
        designKeys.forEach { defaults.removeObject(forKey: $0) }
        defaults.set(true, forKey: "devSeededFromMainApp")
    }

    /// Resolve the configured terminal font. An empty name means the macOS
    /// system font (San Francisco) — a *proportional* font, so the terminal and
    /// the agent CLI render in proper typography rather than monospace. Font
    /// pickers hand back *family* names (e.g. "JetBrains Mono"), which
    /// `NSFont(name:)` often can't resolve, so fall back to a family lookup
    /// before the system monospace default. This is what makes a chosen terminal
    /// font actually apply to the live terminal (including the agent CLI).
    func resolvedFont() -> NSFont {
        if fontName.isEmpty {
            return NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        }
        if let f = NSFont(name: fontName, size: fontSize) {
            return f
        }
        if let f = NSFontManager.shared.font(withFamily: fontName, traits: [], weight: 5, size: fontSize) {
            return f
        }
        return NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    }

    /// Sentinel tag for "use the macOS system font" in the interface-font picker.
    static let systemFontTag = ""

    /// A SwiftUI interface (proportional) font for app chrome. Honors the user's
    /// chosen interface font, defaulting to San Francisco.
    func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let scaled = size * CGFloat(uiFontSize / 13.0)
        if uiFontName.isEmpty {
            return .system(size: scaled, weight: weight)
        }
        return .custom(uiFontName, size: scaled).weight(weight)
    }

    /// A SwiftUI font for command / code text, using the terminal font. Empty
    /// name → the proportional system font (matches the live terminal).
    func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        fontName.isEmpty ? .system(size: size, weight: weight, design: .monospaced)
                         : .custom(fontName, size: size).weight(weight)
    }

    /// Every font family installed on the system (sorted), for the picker.
    /// Enumerating fonts walks every installed family, and the pickers call this
    /// at view init / as a default parameter — so it ran on every parent
    /// re-render. Cache it once per app run instead.
    private static let cachedAllFontFamilies = NSFontManager.shared.availableFontFamilies.sorted()

    static func allFontFamilies() -> [String] { cachedAllFontFamilies }

    private static let cachedMonospacedFontFamilies: [String] = {
        let all = NSFontManager.shared.availableFontFamilies
        // Heuristic: keep families that have a fixed-pitch member.
        var result: [String] = []
        for family in all {
            if let members = NSFontManager.shared.availableMembers(ofFontFamily: family) {
                let isFixed = members.contains { member in
                    if let traits = member[3] as? NSNumber {
                        return NSFontTraitMask(rawValue: UInt(traits.uintValue)).contains(.fixedPitchFontMask)
                    }
                    return false
                }
                if isFixed { result.append(family) }
            }
        }
        // Always surface the common terminal favorites first if present.
        let favorites = ["SF Mono", "Menlo", "Monaco", "JetBrains Mono", "Fira Code", "Cascadia Code"]
        let present = favorites.filter { result.contains($0) }
        let others = result.filter { !present.contains($0) }.sorted()
        return present + others
    }()

    /// Monospaced font families available on the system, for the picker.
    static func monospacedFontFamilies() -> [String] { cachedMonospacedFontFamilies }
}
