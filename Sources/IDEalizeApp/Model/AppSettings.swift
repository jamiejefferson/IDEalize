import SwiftUI
import AppKit

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
    /// Opacity of the chat modal card (lower = more blurred terminal shows through).
    @Published var chatTranslucency: Double {
        didSet { defaults.set(chatTranslucency, forKey: "chatTranslucency") }
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
    /// Manual chat-modal height as a fraction of the pane (0 = auto / content-sized).
    @Published var chatHeightFraction: Double {
        didSet { defaults.set(chatHeightFraction, forKey: "chatHeightFraction") }
    }
    /// Gaussian blur radius applied to the terminal backdrop in chat mode.
    @Published var terminalBlur: Double {
        didSet { defaults.set(terminalBlur, forKey: "terminalBlur") }
    }
    /// Left/right inset (points) between the terminal grid and the pane edges.
    /// The gap is painted with the terminal's own background so it reads as
    /// breathing room around the text. 0 = flush to the edges.
    @Published var terminalMargin: Double {
        didSet { defaults.set(terminalMargin, forKey: "terminalMargin") }
    }
    /// Inner padding (margins) of the chat modal.
    @Published var chatMargin: Double {
        didSet { defaults.set(chatMargin, forKey: "chatMargin") }
    }
    /// Optional chat text colour as a hex string ("" = use the theme foreground).
    @Published var chatTextColorHex: String {
        didSet { defaults.set(chatTextColorHex, forKey: "chatTextColorHex") }
    }
    /// Whether Return sends the chat message (off → Return inserts a newline; ⌘↩ sends).
    @Published var returnToSend: Bool {
        didSet { defaults.set(returnToSend, forKey: "returnToSend") }
    }
    /// Whether releasing the dictation key/button auto-sends the captured speech.
    @Published var voiceReleaseToSend: Bool {
        didSet { defaults.set(voiceReleaseToSend, forKey: "voiceReleaseToSend") }
    }

    /// The chat text colour — the override if set, otherwise the theme foreground.
    var chatTextColor: NSColor {
        if let c = NSColor(hex: chatTextColorHex) { return c }
        return theme.foreground
    }

    // MARK: Theme
    @Published var themeName: String {
        didSet { defaults.set(themeName, forKey: "themeName") }
    }
    var theme: Theme { Theme.named(themeName) }

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

    // MARK: Behavior
    @Published var notificationsEnabled: Bool {
        didSet { defaults.set(notificationsEnabled, forKey: "notificationsEnabled") }
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
    /// Recently opened folders (most-recent first) for the File ▸ Open Recent menu.
    @Published var recentFolders: [String] {
        didSet { defaults.set(recentFolders, forKey: "recentFolders") }
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
        // Empty = the proportional system font (proper typography by default).
        self.fontName = defaults.string(forKey: "fontName") ?? ""
        self.fontSize = defaults.object(forKey: "fontSize") as? Double ?? 13.0
        self.uiFontName = defaults.string(forKey: "uiFontName") ?? ""
        self.uiFontSize = defaults.object(forKey: "uiFontSize") as? Double ?? 13.0
        self.chatFontSize = defaults.object(forKey: "chatFontSize") as? Double ?? 16.0
        self.chatLineSpacing = defaults.object(forKey: "chatLineSpacing") as? Double ?? 5.0
        self.chatTranslucency = defaults.object(forKey: "chatTranslucency") as? Double ?? 0.80
        self.chatInputOpacity = defaults.object(forKey: "chatInputOpacity") as? Double ?? 1.0
        self.chatInputLineSpacing = defaults.object(forKey: "chatInputLineSpacing") as? Double ?? 2.0
        self.chatShadowOpacity = defaults.object(forKey: "chatShadowOpacity") as? Double ?? 0.4
        self.chatHeightFraction = defaults.object(forKey: "chatHeightFraction") as? Double ?? 0.0
        self.terminalBlur = defaults.object(forKey: "terminalBlur") as? Double ?? 3.0
        self.terminalMargin = defaults.object(forKey: "terminalMargin") as? Double ?? 0.0
        self.chatMargin = defaults.object(forKey: "chatMargin") as? Double ?? 18.0
        self.chatTextColorHex = defaults.string(forKey: "chatTextColorHex") ?? ""
        self.returnToSend = defaults.object(forKey: "returnToSend") as? Bool ?? true
        self.voiceReleaseToSend = defaults.object(forKey: "voiceReleaseToSend") as? Bool ?? false
        self.themeName = defaults.string(forKey: "themeName") ?? Theme.idealizeDark.name
        self.defaultLaunchCommand = defaults.string(forKey: "defaultLaunchCommand")
            ?? "claude --dangerously-skip-permissions"
        // Opt-in: auto-launching an agent (with permissions skipped) on every new
        // terminal is off unless the user flips the switch.
        self.launchOnNewTerminal = defaults.object(forKey: "launchOnNewTerminal") as? Bool ?? false
        self.shellPath = defaults.string(forKey: "shellPath")
            ?? (ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
        self.notificationsEnabled = defaults.object(forKey: "notificationsEnabled") as? Bool ?? true
        self.hasSeenWelcome = defaults.object(forKey: "hasSeenWelcome") as? Bool ?? false
        self.hasSeenTour = defaults.object(forKey: "hasSeenTour") as? Bool ?? false
        self.recentFolders = defaults.stringArray(forKey: "recentFolders") ?? []
        self.miniModeEnabled = defaults.object(forKey: "miniModeEnabled") as? Bool ?? false
        self.miniModeDockSide = DockSide(rawValue: defaults.string(forKey: "miniModeDockSide") ?? "") ?? .right
        self.miniModeAlwaysOnTop = defaults.object(forKey: "miniModeAlwaysOnTop") as? Bool ?? true
        self.browseFolders = defaults.dictionary(forKey: "browseFolders") as? [String: String] ?? [:]
        self.browseOpen = defaults.dictionary(forKey: "browseOpen") as? [String: Bool] ?? [:]
        self.panelAppearances = (defaults.data(forKey: "panelAppearances")
            .flatMap { try? JSONDecoder().decode([String: PanelAppearance].self, from: $0) }) ?? [:]
        self.actionAppearance = (defaults.data(forKey: "actionAppearance")
            .flatMap { try? JSONDecoder().decode(ActionAppearance.self, from: $0) }) ?? .empty
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
