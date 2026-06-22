import SwiftUI
import AppKit

/// A colour well + directly-editable hex field. Typing a valid hex (with or
/// without "#") commits it; invalid input reverts.
struct HexField: View {
    @Binding var hex: String
    var fallback: Color
    var allowClear: Bool = true
    var width: CGFloat = 80
    @ObservedObject private var settings = AppSettings.shared
    @State private var draft = ""
    // The picker drives its own HSB colour; we only push to hex (and pull back
    // when hex genuinely changes) to stop the wheel/lightness fighting itself.
    @State private var pickerColor: Color = .gray

    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(spacing: 6) {
            ColorPicker("", selection: $pickerColor, supportsOpacity: false)
                .labelsHidden().frame(width: 32)
                .onChange(of: pickerColor) {
                    let h = NSColor(pickerColor).hexString
                    if h != hex { hex = h }
                }
                .onChange(of: hex) { syncPickerFromHex() }
                .onAppear { syncPickerFromHex() }
            HStack(spacing: 2) {
                Text("#").font(settings.ui(11).monospacedDigit())
                    .foregroundStyle(Color(theme.secondaryForeground))
                TextField("inherit", text: $draft)
                    .textFieldStyle(.plain)
                    .font(settings.ui(11).monospacedDigit())
                    .foregroundStyle(Color(theme.foreground))
                    .frame(width: width)
                    .onSubmit(commit)
                    .onChange(of: hex) { draft = displayValue }
                    .onAppear { draft = displayValue }
            }
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color(theme.surface)))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color(theme.border), lineWidth: 1))
            if allowClear && !hex.isEmpty {
                Button(action: { hex = ""; draft = "" }) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 11))
                        .foregroundStyle(Color(theme.secondaryForeground))
                }.buttonStyle(.plain).help("Clear")
            }
        }
    }

    private var displayValue: String {
        hex.isEmpty ? "" : hex.replacingOccurrences(of: "#", with: "").uppercased()
    }

    private func commit() {
        var s = draft.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.isEmpty { hex = ""; return }
        if let c = NSColor(hex: s) { hex = c.hexString } else { draft = displayValue }
    }

    /// Pull the picker's colour from `hex` — but only when it genuinely differs,
    /// so the picker keeps its own HSB state mid-drag (no wheel/lightness fight).
    private func syncPickerFromHex() {
        let target = NSColor(hex: hex).map { Color($0) } ?? fallback
        if NSColor(target).hexString != NSColor(pickerColor).hexString {
            pickerColor = target
        }
    }
}

/// A Figma-style multi-stop gradient editor: type picker, preview bar, an
/// angle control, and an add/remove list of colour stops.
struct GradientEditor: View {
    @Binding var type: Int
    @Binding var angle: Double
    @Binding var stops: [GradientStop]
    /// Used to seed two stops the first time the editor appears empty.
    var seed: () -> [GradientStop]
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }
    private var gtype: GradientType { GradientType(rawValue: type) ?? .linear }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Picker("", selection: $type) {
                    ForEach(GradientType.allCases, id: \.rawValue) { t in
                        Text(t.label).tag(t.rawValue)
                    }
                }.labelsHidden().frame(width: 110)
                Spacer()
                Button(action: reverse) {
                    Image(systemName: "arrow.left.arrow.right").font(.system(size: 11))
                }.buttonStyle(.plain).help("Reverse stops")
                    .foregroundStyle(Color(theme.secondaryForeground))
                Button(action: { angle = (angle + 45).truncatingRemainder(dividingBy: 360) }) {
                    Image(systemName: "rotate.right").font(.system(size: 11))
                }.buttonStyle(.plain).help("Rotate 45°")
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .disabled(gtype == .radial)
            }

            // Preview bar.
            RoundedRectangle(cornerRadius: 7)
                .fill(makeGradientStyle(stops, type: gtype, angle: angle))
                .frame(height: 26)
                .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color(theme.border), lineWidth: 1))

            if gtype != .radial {
                HStack(spacing: 8) {
                    Text("Angle").font(settings.ui(11)).foregroundStyle(Color(theme.secondaryForeground))
                        .frame(width: 44, alignment: .leading)
                    Slider(value: $angle, in: 0...360, step: 1).controlSize(.small)
                    Text(String(format: "%.0f°", angle)).font(settings.ui(11, .medium).monospacedDigit())
                        .foregroundStyle(Color(theme.foreground)).frame(width: 36, alignment: .trailing)
                }
            }

            HStack {
                Text("STOPS").font(settings.ui(10, .semibold)).tracking(0.6)
                    .foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                Button(action: addStop) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color(theme.accent))
                }.buttonStyle(.plain).help("Add a stop")
            }

            ForEach($stops) { $stop in
                HStack(spacing: 6) {
                    percentField($stop.location)
                    HexField(hex: $stop.colorHex, fallback: .gray, allowClear: false, width: 64)
                    Spacer(minLength: 0)
                    Button(action: { remove(stop.id) }) {
                        Image(systemName: "minus.circle").font(.system(size: 12))
                            .foregroundStyle(Color(theme.secondaryForeground))
                    }.buttonStyle(.plain).disabled(stops.count <= 1).help("Remove stop")
                }
            }
        }
        .onAppear { if stops.isEmpty { stops = seed() } }
    }

    private func percentField(_ loc: Binding<Double>) -> some View {
        let pct = Binding<Int>(
            get: { Int((loc.wrappedValue * 100).rounded()) },
            set: { loc.wrappedValue = min(1, max(0, Double($0) / 100)) }
        )
        return HStack(spacing: 1) {
            TextField("", value: pct, format: .number)
                .textFieldStyle(.plain).font(settings.ui(11).monospacedDigit())
                .frame(width: 30).multilineTextAlignment(.trailing)
            Text("%").font(settings.ui(10)).foregroundStyle(Color(theme.secondaryForeground))
        }
        .padding(.horizontal, 5).padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 5).fill(Color(theme.surface)))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Color(theme.border), lineWidth: 1))
    }

    private func reverse() {
        stops = stops.map { GradientStop(id: $0.id, colorHex: $0.colorHex, location: 1 - $0.location) }
    }

    private func addStop() {
        if stops.isEmpty { stops = seed(); return }
        let sorted = stops.sorted { $0.location < $1.location }
        // Drop the new stop into the widest gap (including the 0…1 ends) so
        // repeated adds spread out instead of stacking at one location.
        var candidates: [(mid: Double, gap: Double, color: String)] = []
        if let first = sorted.first, first.location > 0.001 {
            candidates.append((first.location / 2, first.location, first.colorHex))
        }
        for i in 0..<(sorted.count - 1) {
            let a = sorted[i], b = sorted[i + 1]
            candidates.append(((a.location + b.location) / 2, b.location - a.location, a.colorHex))
        }
        if let last = sorted.last, last.location < 0.999 {
            candidates.append(((last.location + 1) / 2, 1 - last.location, last.colorHex))
        }
        let best = candidates.max { $0.gap < $1.gap }
        stops.append(GradientStop(colorHex: best?.color ?? "#888888",
                                  location: best?.mid ?? 0.5))
    }

    private func remove(_ id: UUID) {
        guard stops.count > 1 else { return }
        stops.removeAll { $0.id == id }
    }
}
