import SwiftUI
import AppKit

/// The in-view Appearance inspector — IDEalize's USP.
///
/// Organised as six tabs (Theme + one per surface), showing one section at a
/// time. Every setting lives in exactly one section, so nothing is reachable
/// from two places: the terminal's font size has one slider, chat is configured
/// in one tab, and "Reset" always means "the things you can currently see".
///
/// The mental model the tabs teach: **the theme is the base, and editing a
/// surface layers your own values over it** — which is what a custom theme is.
/// The Theme tab names that layer and can strip it back off.
struct AppearancePanel: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    /// In mini-mode the inspector fills a narrow full-width column instead of
    /// docking as a fixed 360-wide trailing panel (which would overflow ~320px).
    var compact: Bool = false

    private let allFamilies = AppSettings.allFontFamilies()
    private let terminalFamilies: [String] = {
        let mono = AppSettings.monospacedFontFamilies()
        return mono + AppSettings.allFontFamilies().filter { !mono.contains($0) }
    }()

    private var theme: Theme { settings.theme }
    private var section: AppearanceSection { workspace.appearanceSection }

    /// Binding to one panel's appearance override.
    private func appearance(_ kind: PanelKind) -> Binding<PanelAppearance> {
        Binding(get: { settings.appearance(kind) },
                set: { settings.setAppearance($0, for: kind) })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            sectionTabs
            Divider().overlay(Color(theme.border))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    sectionBody
                }
                .padding(16)
                .padding(.bottom, 28)   // clear the last card from the window edge
                // Re-identify per section so switching tabs starts at the top
                // rather than keeping the previous section's scroll offset.
                .id(section)
            }
        }
        // Fixed 360 as a docked column; fills the column in mini-mode.
        .frame(minWidth: compact ? nil : 360, maxWidth: compact ? .infinity : 360)
        .frame(maxHeight: .infinity)
        .background(Color(theme.chrome))
        .overlay(alignment: .leading) {
            if !compact { Rectangle().fill(Color(theme.border)).frame(width: 1) }
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "paintpalette").font(.system(size: 12))
                .foregroundStyle(Color(theme.accent))
            Text("Appearance").font(settings.ui(14, .semibold))
                .foregroundStyle(Color(theme.foreground))
            Spacer()
            // No in-panel close button: the Appearance panel is dismissed with its
            // toolbar toggle (⌘⌥A), the same way the rail/files/viewer panels are.
        }
        .padding(.horizontal, 14).frame(height: 34)
    }

    /// The six section tabs, pinned above the scroll view so the section you're
    /// editing is always named. 3×2 so the labels stay readable in mini-mode.
    private var sectionTabs: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
            ForEach(AppearanceSection.allCases) { s in
                Button(action: { workspace.appearanceSection = s }) {
                    VStack(spacing: 4) {
                        Image(systemName: s.icon).font(.system(size: 13))
                        Text(s.label).font(settings.ui(10, .medium))
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 7)
                        .fill(s == section ? settings.actionStyle.softFill : AnyShapeStyle(Color(theme.surface))))
                    .overlay(RoundedRectangle(cornerRadius: 7)
                        .strokeBorder(s == section ? settings.actionStyle.color : Color(theme.border),
                                      lineWidth: s == section ? 1.5 : 1))
                    .foregroundStyle(Color(s == section ? theme.foreground : theme.secondaryForeground))
                }.buttonStyle(.plain)
                .overlay(alignment: .topTrailing) {
                    if isCustomised(s) {
                        Circle().fill(Color(theme.accent)).frame(width: 5, height: 5).padding(5)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
    }

    @ViewBuilder
    private var sectionBody: some View {
        switch section {
        case .theme:    themeSection
        case .sessions: surfaceSection(.sessions)
        case .files:    surfaceSection(.files)
        case .doc:      surfaceSection(.doc)
        case .chat:     chatSection
        case .terminal: terminalSection
        }
    }

    // MARK: - Section 1: Theme (the base + everything genuinely global)

    @ViewBuilder
    private var themeSection: some View {
        card("Theme") {
            Text("The base colours for the whole app. The terminal keeps its own — see the Terminal tab.")
                .font(settings.ui(10)).foregroundStyle(Color(theme.secondaryForeground))
            VStack(spacing: 6) {
                ForEach(Theme.all) { t in
                    themeRow(t, selected: settings.themeName == t.name) { settings.themeName = t.name }
                }
            }
            themeOverrideNotice
        }
        card("Action colour") {
            actionRows
        }
        card("Interface type") {
            globalFontRow("Interface font", $settings.uiFontName, families: allFamilies)
            slider("Interface size", $settings.uiFontSize, 10...18, step: 1) { String(format: "%.0f", $0) }
        }
    }

    /// What you've set that overrides a theme *colour*, and so keeps its own
    /// look when you switch theme. Scalar settings (margins, blur, opacity,
    /// interface size) aren't theme values, so they don't belong here — and
    /// nor does the terminal, which is styled by its own theme rather than an
    /// override.
    private var themeOverrides: [String] {
        var names: [String] = []
        if settings.actionAppearance.isCustomised { names.append("Action colour") }
        names += PanelKind.allCases
            .filter { $0 != .terminal && settings.appearance($0).isCustomised }
            .map(\.label)
        return names
    }

    /// The warning under the theme list: picking a new theme won't fully take
    /// effect while these are set, because an override always wins over the
    /// theme. Shown only when there's something to warn about.
    @ViewBuilder
    private var themeOverrideNotice: some View {
        let names = themeOverrides
        if !names.isEmpty {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10))
                Text("\(sentenceList(names)) \(names.count == 1 ? "has" : "have") "
                     + "colours of their own, so switching theme won't change "
                     + "\(names.count == 1 ? "it" : "them"). Reset in "
                     + "\(names.count == 1 ? "its" : "their") own tab\(names.count == 1 ? "" : "s").")
                    .font(settings.ui(10))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Color(theme.secondaryForeground))
            .padding(.top, 2)
        }
    }

    /// "A", "A and B", "A, B and C".
    private func sentenceList(_ items: [String]) -> String {
        switch items.count {
        case 0:  return ""
        case 1:  return items[0]
        case 2:  return "\(items[0]) and \(items[1])"
        default: return items.dropLast().joined(separator: ", ") + " and " + (items.last ?? "")
        }
    }

    private var actionRows: some View {
        let action = Binding(get: { settings.actionAppearance }, set: { settings.actionAppearance = $0 })
        return VStack(alignment: .leading, spacing: 10) {
            Text("Buttons, selected-panel borders & active toolbar icons.")
                .font(settings.ui(10)).foregroundStyle(Color(theme.secondaryForeground))
            Picker("", selection: action.mode) {
                Text("Solid").tag(0)
                Text("Gradient").tag(1)
            }.pickerStyle(.segmented).labelsHidden()
            if action.mode.wrappedValue == 1 {
                GradientEditor(type: action.gradientType,
                               angle: action.angle,
                               stops: action.gradientStops,
                               seed: { defaultStops(action.colorHex.wrappedValue,
                                                    action.color2Hex.wrappedValue,
                                                    theme.accent, theme.accent) })
            } else {
                colorRow("Colour", action.colorHex, fallback: Color(theme.accent))
            }
            slider("Opacity", action.opacity, 0...1, step: 0.01,
                   display: { String(format: "%.0f%%", $0 * 100) })
        }
    }

    // MARK: - Sections 2/3/5: Projects · Files · Document

    /// A surface that is styled by its `PanelAppearance` override. Takes the
    /// section (not the panel) so the status row and reset can never end up
    /// scoped to a different section than the controls below them.
    @ViewBuilder
    private func surfaceSection(_ s: AppearanceSection) -> some View {
        if let kind = s.panel {
            statusRow(for: s)
            card("Typography") { typographyRows(kind) }
            card("Background") { backgroundRows(kind) }
        }
    }

    private func typographyRows(_ kind: PanelKind) -> some View {
        let a = appearance(kind)
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Font").font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                FontPicker(fontName: a.fontName, width: 180)
            }
            HStack {
                Text("Weight").font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                Picker("", selection: a.fontWeight) {
                    ForEach(Array(AppearanceWeights.labels.enumerated()), id: \.offset) { i, label in
                        Text(label).tag(i)
                    }
                }.labelsHidden().frame(maxWidth: 140)
            }
            slider("Size", a.fontSize, 0...28, step: 0.5,
                   display: { $0 == 0 ? "Auto" : String(format: "%.0f", $0) })
            slider("Letter-spacing", a.tracking, -2...8, step: 0.1,
                   display: { String(format: "%.1f", $0) })
            slider("Line-spacing", a.lineSpacing, 0...16, step: 0.5,
                   display: { String(format: "%.0f", $0) })
            colorRow("Text colour", a.textColorHex, fallback: Color(theme.foreground))
        }
    }

    private func backgroundRows(_ kind: PanelKind) -> some View {
        let a = appearance(kind)
        return VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: a.bgMode) {
                Text("Inherit").tag(FillMode.inherit.rawValue)
                Text("Solid").tag(FillMode.solid.rawValue)
                Text("Gradient").tag(FillMode.gradient.rawValue)
            }.pickerStyle(.segmented).labelsHidden()

            if a.bgMode.wrappedValue == FillMode.solid.rawValue {
                colorRow("Colour", a.bgColorHex, fallback: Color(theme.background))
            }
            if a.bgMode.wrappedValue == FillMode.gradient.rawValue {
                GradientEditor(type: a.bgGradientType,
                               angle: a.gradientAngle,
                               stops: a.bgGradientStops,
                               seed: { defaultStops(a.bgColorHex.wrappedValue,
                                                    a.bgColor2Hex.wrappedValue,
                                                    theme.background, theme.surface) })
            }
            if a.bgMode.wrappedValue != FillMode.inherit.rawValue {
                slider("Opacity", a.bgOpacity, 0...1, step: 0.01,
                       display: { String(format: "%.0f%%", $0 * 100) })
            }
        }
    }

    // MARK: - Section 4: Chat

    /// The chat surface's own typography/background plus the settings that only
    /// the chat panel has. Both used to live in separate cards with nothing
    /// saying they styled the same surface.
    @ViewBuilder
    private var chatSection: some View {
        surfaceSection(.chat)
        card("Chat panel") {
            slider("Input opacity", $settings.chatInputOpacity, 0.3...1.0, step: 0.02) { String(format: "%.0f%%", $0 * 100) }
            slider("Input line spacing", $settings.chatInputLineSpacing, 0...16, step: 0.5) { String(format: "%.1f", $0) }
            slider("Shadow", $settings.chatShadowOpacity, 0...0.8, step: 0.02) { String(format: "%.0f%%", $0 * 100) }
            slider("Margins", $settings.chatMargin, 8...40, step: 1) { String(format: "%.0f", $0) }
            // The terminal backdrop is only blurred in chat mode, so it belongs
            // here rather than in the Terminal tab where it used to sit.
            slider("Backdrop blur", $settings.terminalBlur, 0...20, step: 1) { String(format: "%.0f", $0) }
            toggleRow("Send on Return", $settings.returnToSend)
        }
    }

    // MARK: - Section 6: Terminal

    /// The grid has no per-panel override — it's styled by its own theme and
    /// font settings, so there is exactly one place to change each of them.
    @ViewBuilder
    private var terminalSection: some View {
        statusRow(for: .terminal)
        card("Terminal theme") {
            Text("The grid keeps its own scheme, independent of the app theme. Ink and Linen are terminal-only.")
                .font(settings.ui(10)).foregroundStyle(Color(theme.secondaryForeground))
            VStack(spacing: 6) {
                ForEach(Theme.terminalThemes) { t in
                    themeRow(t, selected: settings.terminalThemeName == t.name) {
                        settings.terminalThemeName = t.name
                    }
                }
            }
        }
        card("Terminal type") {
            globalFontRow("Font", $settings.fontName, families: terminalFamilies)
            slider("Font size", $settings.fontSize, 9...28, step: 0.5) { String(format: "%.1f", $0) }
            slider("Line spacing", $settings.terminalLineSpacing, 1...3, step: 0.1) { String(format: "%.1f", $0) }
            slider("Margins", $settings.terminalMargin, 0...80, step: 2) { String(format: "%.0f", $0) }
        }
    }

    // MARK: - Customised state & reset
    //
    // "Customised" and "Reset" share one definition per section, so the dot on a
    // tab, the status row inside it and the reset button can never disagree
    // about what that section owns. Theme *choices* (which theme is selected)
    // are never reset — only the values layered over them.

    private func isCustomised(_ s: AppearanceSection) -> Bool {
        switch s {
        case .theme:
            return settings.actionAppearance.isCustomised
                || settings.uiFontName != AppearanceDefaults.uiFontName
                || settings.uiFontSize != AppearanceDefaults.uiFontSize
        case .chat:
            return settings.appearance(.chat).isCustomised
                || settings.chatInputOpacity != AppearanceDefaults.chatInputOpacity
                || settings.chatInputLineSpacing != AppearanceDefaults.chatInputLineSpacing
                || settings.chatShadowOpacity != AppearanceDefaults.chatShadowOpacity
                || settings.chatMargin != AppearanceDefaults.chatMargin
                || settings.terminalBlur != AppearanceDefaults.terminalBlur
                || settings.returnToSend != AppearanceDefaults.returnToSend
        case .terminal:
            return settings.fontName != AppearanceDefaults.fontName
                || settings.fontSize != AppearanceDefaults.fontSize
                || settings.terminalLineSpacing != AppearanceDefaults.terminalLineSpacing
                || settings.terminalMargin != AppearanceDefaults.terminalMargin
        default:
            return s.panel.map { settings.appearance($0).isCustomised } ?? false
        }
    }

    private func resetSection(_ s: AppearanceSection) {
        switch s {
        case .theme:
            settings.actionAppearance = .empty
            settings.uiFontName = AppearanceDefaults.uiFontName
            settings.uiFontSize = AppearanceDefaults.uiFontSize
        case .chat:
            settings.setAppearance(.empty, for: .chat)
            settings.chatInputOpacity = AppearanceDefaults.chatInputOpacity
            settings.chatInputLineSpacing = AppearanceDefaults.chatInputLineSpacing
            settings.chatShadowOpacity = AppearanceDefaults.chatShadowOpacity
            settings.chatMargin = AppearanceDefaults.chatMargin
            settings.terminalBlur = AppearanceDefaults.terminalBlur
            settings.returnToSend = AppearanceDefaults.returnToSend
        case .terminal:
            settings.fontName = AppearanceDefaults.fontName
            settings.fontSize = AppearanceDefaults.fontSize
            settings.terminalLineSpacing = AppearanceDefaults.terminalLineSpacing
            settings.terminalMargin = AppearanceDefaults.terminalMargin
        default:
            if let p = s.panel { settings.setAppearance(.empty, for: p) }
        }
    }

    /// Says whether this section is following the theme or overriding it, and
    /// offers the one reset whose scope is exactly what's shown below.
    private func statusRow(for s: AppearanceSection) -> some View {
        let customised = isCustomised(s)
        let following = s == .terminal ? "Default terminal settings" : "Following \(settings.themeName)"
        return HStack(spacing: 6) {
            Circle().fill(customised ? Color(theme.accent) : Color(theme.secondaryForeground).opacity(0.5))
                .frame(width: 5, height: 5)
            Text(customised ? "Customised" : following)
                .font(settings.ui(11)).foregroundStyle(Color(theme.secondaryForeground))
                .lineLimit(1)
            Spacer(minLength: 4)
            if customised {
                Button(action: { resetSection(s) }) {
                    Label("Reset", systemImage: "arrow.uturn.backward")
                        .font(settings.ui(11, .medium))
                }.buttonStyle(.plain).foregroundStyle(Color(theme.secondaryForeground))
                    .help("Reset everything in the \(s.label) section")
            }
        }
        .padding(.horizontal, 2)
    }

    // MARK: - Reusable controls

    /// A titled, bordered group.
    private func card<Content: View>(_ title: String,
                                     @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            Text(title).font(settings.ui(11, .semibold)).foregroundStyle(Color(theme.foreground))
                .frame(maxWidth: .infinity, alignment: .leading)
            content()
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(theme.surface).opacity(0.45)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(theme.border).opacity(0.5), lineWidth: 1))
    }

    /// One selectable theme, bound by the caller so the app and terminal lists
    /// share a single implementation.
    private func themeRow(_ t: Theme, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 5).fill(Color(t.background))
                    .frame(width: 42, height: 24)
                    .overlay(HStack(spacing: 2) {
                        ForEach(1..<5) { i in Circle().fill(Color(t.ansi[i])).frame(width: 5, height: 5) }
                    })
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color(theme.border), lineWidth: 1))
                Text(t.name).font(settings.ui(12, .medium)).foregroundStyle(Color(theme.foreground))
                Spacer()
                if selected {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 13))
                        .foregroundStyle(settings.actionStyle.color)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: 8)
                .fill(selected ? settings.actionStyle.softFill : AnyShapeStyle(Color(theme.surface))))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .strokeBorder(selected ? settings.actionStyle.color : Color(theme.border),
                              lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }

    private func globalFontRow(_ label: String, _ binding: Binding<String>, families: [String]) -> some View {
        HStack {
            Text(label).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            FontPicker(fontName: binding, families: families, width: 156)
        }
    }

    private func slider(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>,
                        step: Double, display: @escaping (Double) -> String) -> some View {
        HStack(spacing: 8) {
            Text(label).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 100, alignment: .leading).lineLimit(1)
            Slider(value: value, in: range, step: step).controlSize(.small)
            Text(display(value.wrappedValue)).font(settings.ui(11, .medium).monospacedDigit())
                .foregroundStyle(Color(theme.foreground)).frame(width: 42, alignment: .trailing)
        }
    }

    private func colorRow(_ label: String, _ hex: Binding<String>, fallback: Color,
                          allowClear: Bool = true) -> some View {
        HStack(spacing: 8) {
            Text(label).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                .frame(width: 96, alignment: .leading)
            HexField(hex: hex, fallback: fallback, allowClear: allowClear)
            Spacer(minLength: 0)
        }
    }

    private func toggleRow(_ label: String, _ isOn: Binding<Bool>) -> some View {
        HStack {
            Text(label).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            Toggle("", isOn: isOn).labelsHidden().controlSize(.mini)
        }
    }
}
