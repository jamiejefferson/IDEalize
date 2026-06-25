import SwiftUI
import AppKit

/// The in-view Appearance inspector — IDEalize's USP. Tune typography and
/// background *per panel*, plus a global action colour, with a live preview.
struct AppearancePanel: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject private var settings = AppSettings.shared

    private let allFamilies = AppSettings.allFontFamilies()
    private let terminalFamilies: [String] = {
        let mono = AppSettings.monospacedFontFamilies()
        return mono + AppSettings.allFontFamilies().filter { !mono.contains($0) }
    }()

    private var theme: Theme { settings.theme }
    private var kind: PanelKind { workspace.appearanceTarget }

    /// Binding to the currently-edited panel's appearance.
    private var appearance: Binding<PanelAppearance> {
        Binding(get: { settings.appearance(kind) },
                set: { settings.setAppearance($0, for: kind) })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color(theme.border))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    themeCard
                    perPanelCard
                    actionCard
                    appTypographyCard
                    chatCard
                    terminalCard
                    resetRow
                }
                .padding(16)
                .padding(.bottom, 28)   // clear the last card from the window edge
            }
        }
        .frame(width: 360)
        .frame(maxHeight: .infinity)
        .background(Color(theme.chrome))
        .overlay(alignment: .leading) { Rectangle().fill(Color(theme.border)).frame(width: 1) }
    }

    // MARK: - Cards (grouped, spaced — the gaps give the scroll wheel a target
    // that isn't a slider, which is what made the old flat list feel unscrollable)

    /// A titled, bordered group. `subtitle` shows a faint qualifier (e.g. the
    /// panel being edited, or "global").
    private func card<Content: View>(_ title: String, subtitle: String? = nil,
                                     @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 6) {
                Text(title).font(settings.ui(11, .semibold)).foregroundStyle(Color(theme.foreground))
                if let subtitle {
                    Text("· \(subtitle)").font(settings.ui(9))
                        .foregroundStyle(Color(theme.secondaryForeground)).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            content()
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(theme.surface).opacity(0.45)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(theme.border).opacity(0.5), lineWidth: 1))
    }

    /// A faint sub-heading inside a card, separating sub-groups.
    private func subLabel(_ s: String) -> some View {
        Text(s.uppercased()).font(settings.ui(9, .semibold)).tracking(0.6)
            .foregroundStyle(Color(theme.secondaryForeground).opacity(0.85))
            .padding(.top, 3)
    }

    private var themeCard: some View {
        card("Theme") {
            VStack(spacing: 6) { ForEach(Theme.all) { themeRow($0) } }
        }
    }

    /// The USP: the picker plus the chosen panel's typography and background.
    private var perPanelCard: some View {
        card("Per-panel style", subtitle: kind.label) {
            panelPicker
            Rectangle().fill(Color(theme.border).opacity(0.4)).frame(height: 1).padding(.vertical, 2)
            subLabel("Typography")
            typographyRows
            subLabel("Background")
            backgroundRows
        }
    }

    private var actionCard: some View {
        card("Action colour", subtitle: "global") { actionRows }
    }

    private var appTypographyCard: some View {
        card("App typography") {
            globalFontRow("Interface font", $settings.uiFontName, families: allFamilies)
            slider("Interface size", $settings.uiFontSize, 10...18, step: 1) { String(format: "%.0f", $0) }
            globalFontRow("Terminal font", $settings.fontName, families: terminalFamilies)
            slider("Terminal size", $settings.fontSize, 9...28, step: 1) { String(format: "%.0f", $0) }
        }
    }

    private var chatCard: some View {
        card("Chat") {
            slider("Input opacity", $settings.chatInputOpacity, 0.3...1.0, step: 0.02) { String(format: "%.0f%%", $0 * 100) }
            slider("Input spacing", $settings.chatInputLineSpacing, 0...16, step: 0.5) { String(format: "%.1f", $0) }
            slider("Shadow", $settings.chatShadowOpacity, 0...0.8, step: 0.02) { String(format: "%.0f%%", $0 * 100) }
            slider("Margins", $settings.chatMargin, 8...40, step: 1) { String(format: "%.0f", $0) }
            HStack {
                Text("Send on Return").font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                Toggle("", isOn: $settings.returnToSend).labelsHidden().controlSize(.mini)
            }
        }
    }

    private var terminalCard: some View {
        card("Terminal") {
            slider("Blur", $settings.terminalBlur, 0...20, step: 1) { String(format: "%.0f", $0) }
            slider("Margins", $settings.terminalMargin, 0...80, step: 2) { String(format: "%.0f", $0) }
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "paintpalette").font(.system(size: 12))
                .foregroundStyle(Color(theme.accent))
            Text("Appearance").font(settings.ui(14, .semibold))
                .foregroundStyle(Color(theme.foreground))
            Spacer()
            Button(action: { workspace.showAppearance = false }) {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }.buttonStyle(.plain).help("Close")
        }
        .padding(.horizontal, 14).frame(height: 34)
    }

    // MARK: Panel selector

    private var panelPicker: some View {
        VStack(alignment: .leading, spacing: 7) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                ForEach(PanelKind.allCases) { p in
                    Button(action: { workspace.appearanceTarget = p }) {
                        VStack(spacing: 4) {
                            Image(systemName: p.icon).font(.system(size: 13))
                            Text(p.label).font(settings.ui(10, .medium)).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(RoundedRectangle(cornerRadius: 7)
                            .fill(p == kind ? settings.actionStyle.softFill : AnyShapeStyle(Color(theme.surface))))
                        .overlay(RoundedRectangle(cornerRadius: 7)
                            .strokeBorder(p == kind ? settings.actionStyle.color : Color(theme.border),
                                          lineWidth: p == kind ? 1.5 : 1))
                        .foregroundStyle(Color(p == kind ? theme.foreground : theme.secondaryForeground))
                    }.buttonStyle(.plain)
                    .overlay(alignment: .topTrailing) {
                        if settings.appearance(p).isCustomised {
                            Circle().fill(Color(theme.accent)).frame(width: 5, height: 5).padding(5)
                        }
                    }
                }
            }
        }
    }

    // MARK: Typography

    private var typographyRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            fontRow
            weightRow
            slider("Size", appearance.fontSize, 0...28, step: 0.5,
                   display: { $0 == 0 ? "Auto" : String(format: "%.0f", $0) })
            slider("Letter-spacing", appearance.tracking, -2...8, step: 0.1,
                   display: { String(format: "%.1f", $0) })
            slider("Line-spacing", appearance.lineSpacing, 0...16, step: 0.5,
                   display: { String(format: "%.0f", $0) })
            colorRow("Text colour", appearance.textColorHex, fallback: Color(theme.foreground))
        }
    }

    private var fontRow: some View {
        HStack {
            Text("Font").font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            FontPicker(fontName: appearance.fontName, width: 180)
        }
    }

    private var weightRow: some View {
        HStack {
            Text("Weight").font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            Picker("", selection: appearance.fontWeight) {
                ForEach(Array(AppearanceWeights.labels.enumerated()), id: \.offset) { i, label in
                    Text(label).tag(i)
                }
            }.labelsHidden().frame(maxWidth: 140)
        }
    }

    // MARK: Background

    private var backgroundRows: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: appearance.bgMode) {
                Text("Inherit").tag(FillMode.inherit.rawValue)
                Text("Solid").tag(FillMode.solid.rawValue)
                Text("Gradient").tag(FillMode.gradient.rawValue)
            }.pickerStyle(.segmented).labelsHidden()

            if appearance.bgMode.wrappedValue == FillMode.solid.rawValue {
                colorRow("Colour", appearance.bgColorHex, fallback: Color(theme.background))
            }
            if appearance.bgMode.wrappedValue == FillMode.gradient.rawValue {
                GradientEditor(type: appearance.bgGradientType,
                               angle: appearance.gradientAngle,
                               stops: appearance.bgGradientStops,
                               seed: { defaultStops(appearance.bgColorHex.wrappedValue,
                                                    appearance.bgColor2Hex.wrappedValue,
                                                    theme.background, theme.surface) })
            }
            if appearance.bgMode.wrappedValue != FillMode.inherit.rawValue {
                slider("Opacity", appearance.bgOpacity, 0...1, step: 0.01,
                       display: { String(format: "%.0f%%", $0 * 100) })
            }
        }
    }

    // MARK: Action colour (global)

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

    private var resetRow: some View {
        HStack {
            Button(action: { settings.setAppearance(.empty, for: kind) }) {
                Label("Reset \(kind.label)", systemImage: "arrow.uturn.backward")
                    .font(settings.ui(11, .medium))
            }.buttonStyle(.plain).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            Button(action: {
                for p in PanelKind.allCases { settings.setAppearance(.empty, for: p) }
                settings.actionAppearance = .empty
            }) {
                Text("Reset all").font(settings.ui(11, .medium))
            }.buttonStyle(.plain).foregroundStyle(Color(theme.secondaryForeground))
        }
        .padding(.top, 4)
    }

    // MARK: Theme

    private func themeRow(_ t: Theme) -> some View {
        let selected = settings.themeName == t.name
        return Button(action: { settings.themeName = t.name }) {
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
        }.buttonStyle(.plain)
    }

    private func globalFontRow(_ label: String, _ binding: Binding<String>, families: [String]) -> some View {
        HStack {
            Text(label).font(settings.ui(12)).foregroundStyle(Color(theme.secondaryForeground))
            Spacer()
            FontPicker(fontName: binding, families: families, width: 156)
        }
    }

    // MARK: Reusable controls

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
}
