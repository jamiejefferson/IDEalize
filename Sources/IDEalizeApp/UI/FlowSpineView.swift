import SwiftUI

/// Chunk 1: the static spine. Renders a `Flow.Graph` as a vertical column of
/// cards joined by a connecting line, derived purely from block order and
/// connections (see `Flow.Graph.spine()`). A decision's branches render as
/// labelled, indented sub-spines. Read-only — no editing, no Claude. Everything
/// in the editor hangs off this component.
struct FlowSpineView: View {
    let graph: Flow.Graph

    var body: some View {
        SpineColumn(rows: graph.spine())
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A column of spine rows. Recurses into itself for a decision's branches — a
/// named `View` struct (unlike a `@ViewBuilder` function) can reference itself
/// without tangling SwiftUI's opaque-type inference.
private struct SpineColumn: View {
    let rows: [SpineRow]
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                FlowStepCard(block: row.block)
                if row.branches.isEmpty {
                    if index < rows.count - 1 { connector }
                } else {
                    connector
                    branchRow(row.branches)
                }
            }
        }
    }

    /// A decision's outgoing paths, each indented beneath the card and headed by
    /// its connection label ("yes" / "no").
    private func branchRow(_ branches: [SpineBranch]) -> some View {
        HStack(alignment: .top, spacing: 16) {
            ForEach(branches) { branch in
                VStack(alignment: .leading, spacing: 6) {
                    branchLabel(branch.label)
                    SpineColumn(rows: branch.rows)
                }
                .padding(.leading, 18)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Color(theme.border).opacity(0.6))
                        .frame(width: 1.5)
                }
            }
        }
        .padding(.leading, 10)
    }

    private func branchLabel(_ label: String) -> some View {
        Text(label.isEmpty ? "—" : label)
            .font(settings.ui(10, .semibold))
            .foregroundStyle(settings.actionStyle.color)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Capsule().fill(settings.actionStyle.color.opacity(0.14)))
            .overlay(Capsule().strokeBorder(settings.actionStyle.color.opacity(0.35), lineWidth: 1))
    }

    /// The connecting line between two cards in a column.
    private var connector: some View {
        Capsule()
            .fill(Color(theme.border).opacity(0.7))
            .frame(width: 2, height: 16)
            .padding(.leading, 18)
    }
}

/// One block in the spine. Shows its type badge and its `text` (read-only in
/// chunk 1). Styling mirrors the chat's option rows so it sits at home in the
/// chat region.
struct FlowStepCard: View {
    let block: FlowBlock
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }
    private var size: CGFloat { settings.chatFontSize }

    private var accent: Color {
        switch block.type {
        case .start: return .green
        case .decision: return settings.actionStyle.color
        case .tool: return Color(theme.accent)
        case .end: return Color(theme.secondaryForeground)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            // Read-only (non-interactive), so the icon takes the text colour — it
            // stays as legible as the step text beside it. The type still reads from
            // its shape, label, and the card's accent border.
            Image(systemName: block.type.icon)
                .font(.system(size: size))
                .foregroundStyle(Color(theme.foreground))
                .frame(width: 22)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(block.type.label.uppercased())
                    .font(settings.ui(9, .semibold)).tracking(0.7)
                    .foregroundStyle(Color(theme.secondaryForeground))
                textOrHint
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(theme.surface).opacity(0.7)))
        .overlay(RoundedRectangle(cornerRadius: 10)
            .strokeBorder(accent.opacity(0.35), lineWidth: 1))
    }

    @ViewBuilder private var textOrHint: some View {
        if block.text.isEmpty, let hint = block.hint, !hint.isEmpty {
            Text(hint)
                .font(settings.ui(size - 1))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(block.text)
                .font(settings.ui(size - 1))
                .foregroundStyle(Color(theme.foreground))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
