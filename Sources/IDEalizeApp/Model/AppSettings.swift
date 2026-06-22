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
    /// Base text size for the Claude chat answer panel (proportional). Larger
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
    /// Manual chat-modal height as a fraction of the pane (0 = auto / content-sized).
    @Published var chatHeightFraction: Double {
        didSet { defaults.set(chatHeightFraction, forKey: "chatHeightFraction") }
    }
    /// Gaussian blur radius applied to the terminal backdrop in chat mode.
    @Published var terminalBlur: Double {
        didSet { defaults.set(terminalBlur, forKey: "terminalBlur") }
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
        didSet {
            if let d = try? JSONEncoder().encode(panelAppearances) {
                defaults.set(d, forKey: "panelAppearances")
            }
        }
    }
    /// Global action colour for primary buttons + selected-panel highlight.
    @Published var actionAppearance: ActionAppearance {
        didSet {
            if let d = try? JSONEncoder().encode(actionAppearance) {
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
    /// Recently opened folders (most-recent first) for the File ▸ Open Recent menu.
    @Published var recentFolders: [String] {
        didSet { defaults.set(recentFolders, forKey: "recentFolders") }
    }

    // MARK: Panel widths (user-draggable, persisted)
    @Published var railWidth: Double { didSet { defaults.set(railWidth, forKey: "railWidth") } }
    @Published var filesWidth: Double { didSet { defaults.set(filesWidth, forKey: "filesWidth") } }
    @Published var viewerWidth: Double { didSet { defaults.set(viewerWidth, forKey: "viewerWidth") } }

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
        self.chatHeightFraction = defaults.object(forKey: "chatHeightFraction") as? Double ?? 0.0
        self.terminalBlur = defaults.object(forKey: "terminalBlur") as? Double ?? 3.0
        self.chatMargin = defaults.object(forKey: "chatMargin") as? Double ?? 18.0
        self.chatTextColorHex = defaults.string(forKey: "chatTextColorHex") ?? ""
        self.returnToSend = defaults.object(forKey: "returnToSend") as? Bool ?? true
        self.voiceReleaseToSend = defaults.object(forKey: "voiceReleaseToSend") as? Bool ?? false
        self.themeName = defaults.string(forKey: "themeName") ?? Theme.idealizeDark.name
        self.defaultLaunchCommand = defaults.string(forKey: "defaultLaunchCommand")
            ?? "claude --dangerously-skip-permissions"
        // Claude-native by default: new sessions drop straight into Claude Code.
        self.launchOnNewTerminal = defaults.object(forKey: "launchOnNewTerminal") as? Bool ?? true
        self.shellPath = defaults.string(forKey: "shellPath")
            ?? (ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh")
        self.notificationsEnabled = defaults.object(forKey: "notificationsEnabled") as? Bool ?? true
        self.hasSeenWelcome = defaults.object(forKey: "hasSeenWelcome") as? Bool ?? false
        self.recentFolders = defaults.stringArray(forKey: "recentFolders") ?? []
        self.railWidth = defaults.object(forKey: "railWidth") as? Double ?? 182
        self.filesWidth = defaults.object(forKey: "filesWidth") as? Double ?? 194
        self.viewerWidth = defaults.object(forKey: "viewerWidth") as? Double ?? 400
        self.panelAppearances = (defaults.data(forKey: "panelAppearances")
            .flatMap { try? JSONDecoder().decode([String: PanelAppearance].self, from: $0) }) ?? [:]
        self.actionAppearance = (defaults.data(forKey: "actionAppearance")
            .flatMap { try? JSONDecoder().decode(ActionAppearance.self, from: $0) }) ?? .empty
    }

    /// Resolve the configured terminal font. An empty name means the macOS
    /// system font (San Francisco) — a *proportional* font, so the terminal and
    /// Claude Code render in proper typography rather than monospace. Font
    /// pickers hand back *family* names (e.g. "JetBrains Mono"), which
    /// `NSFont(name:)` often can't resolve, so fall back to a family lookup
    /// before the system monospace default. This is what makes a chosen terminal
    /// font actually apply to the live terminal (including Claude Code).
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
    static func allFontFamilies() -> [String] {
        NSFontManager.shared.availableFontFamilies.sorted()
    }

    /// Monospaced font families available on the system, for the picker.
    static func monospacedFontFamilies() -> [String] {
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
    }
}
