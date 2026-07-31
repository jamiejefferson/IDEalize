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
        let indent = CGFloat(heading.level - 1) * 12
        let fontSize = CGFloat(10 + (6 - heading.level))
        return Button(action: { onSelectHeading(heading) }) {
            HStack(spacing: 6) {
                Text(heading.title)
                    .font(settings.ui(fontSize))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
        .help(heading.title)
        .padding(.leading, 8 + indent)
        .padding(.trailing, 8)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}
