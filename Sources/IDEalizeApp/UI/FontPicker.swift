import SwiftUI
import AppKit

/// A font picker whose dropdown renders every family name set in its own
/// typeface, so you preview the font before choosing it. "" = system default.
struct FontPicker: View {
    @Binding var fontName: String
    /// Family list to offer (defaults to every installed family).
    var families: [String] = AppSettings.allFontFamilies()
    /// Whether to offer the "System (default)" option (empty selection).
    var allowSystem: Bool = true
    var width: CGFloat = 180
    @ObservedObject private var settings = AppSettings.shared
    @State private var open = false

    private var theme: Theme { settings.theme }
    private var label: String { fontName.isEmpty ? "System" : fontName }

    var body: some View {
        Button(action: { open.toggle() }) {
            HStack(spacing: 6) {
                Text(label)
                    .font(fontName.isEmpty ? .system(size: 12) : .custom(fontName, size: 12))
                    .lineLimit(1)
                    .foregroundStyle(Color(theme.foreground))
                Spacer(minLength: 4)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9))
                    .foregroundStyle(Color(theme.secondaryForeground))
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .frame(width: width, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color(theme.surface)))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(theme.border), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            FontList(fontName: $fontName, families: families, allowSystem: allowSystem,
                     close: { open = false })
        }
    }
}

private struct FontList: View {
    @Binding var fontName: String
    let families: [String]
    let allowSystem: Bool
    var close: () -> Void
    @ObservedObject private var settings = AppSettings.shared
    @State private var query = ""

    private var theme: Theme { settings.theme }

    private var filtered: [String] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? families : families.filter { $0.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 11))
                    .foregroundStyle(Color(theme.secondaryForeground))
                TextField("Search fonts", text: $query).textFieldStyle(.plain).font(settings.ui(12))
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if allowSystem && query.isEmpty {
                        row(name: "System (default)", family: nil)
                    }
                    ForEach(filtered, id: \.self) { fam in row(name: fam, family: fam) }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(width: 270, height: 380)
        .background(Color(theme.chrome))
    }

    private func row(name: String, family: String?) -> some View {
        let selected = (family ?? "") == fontName
        return Button(action: { fontName = family ?? ""; close() }) {
            HStack(spacing: 9) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 11))
                    .foregroundStyle(selected ? settings.actionStyle.color : Color(theme.secondaryForeground))
                    .frame(width: 16)
                // The whole point: each name set in its own typeface.
                Text(name)
                    .font(family == nil ? .system(size: 15) : .custom(family!, size: 15))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(1).truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(FontRowStyle())
    }
}

private struct FontRowStyle: ButtonStyle {
    @ObservedObject private var settings = AppSettings.shared
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? Color(settings.theme.surfaceHover) : .clear)
            .onHover { hovering = $0 }
    }
}
