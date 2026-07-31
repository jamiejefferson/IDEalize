import SwiftUI

struct MarkdownNavigationSidebar: View {
    let outline: MarkdownOutline
    let onSelectHeading: (MarkdownHeading) -> Void
    @ObservedObject private var settings = AppSettings.shared

    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(spacing: 0) {
            if outline.headings.isEmpty {
                emptyState
            } else {
                navigationList
            }
        }
        .background(Color(theme.chrome))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "list.bullet.indent")
                .font(.system(size: 18))
                .foregroundStyle(Color(theme.secondaryForeground))
            Text("No headings")
                .font(settings.ui(11))
                .foregroundStyle(Color(theme.secondaryForeground))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(12)
    }

    private var navigationList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(outline.headings) { heading in
                    headingButton(heading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
    }

    private func headingButton(_ heading: MarkdownHeading) -> some View {
        Button(action: { onSelectHeading(heading) }) {
            HStack(spacing: 8) {
                Text(heading.title)
                    .font(settings.ui(11))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .help(heading.title)
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(theme.surface).opacity(0.5))
        )
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .opacity(0.8)
        .contentShape(Rectangle())
    }
}
