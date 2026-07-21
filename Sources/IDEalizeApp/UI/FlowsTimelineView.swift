import SwiftUI

/// A vertical timeline of conversation-built stages. Read-only: the user edits
/// by talking, not by dragging nodes. Each stage shows its definition of done
/// so completion is always explicit.
struct FlowsTimelineView: View {
    let stages: [FlowStage]
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(stages.enumerated()), id: \.element.id) { index, stage in
                TimelineStageRow(stage: stage, isLast: index == stages.count - 1)
            }
        }
    }
}

/// One stage in the timeline, with a connecting line down to the next.
private struct TimelineStageRow: View {
    let stage: FlowStage
    let isLast: Bool
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                // Node marker.
                ZStack {
                    Circle()
                        .fill(settings.actionStyle.color.opacity(0.15))
                        .frame(width: 28, height: 28)
                    Circle()
                        .strokeBorder(settings.actionStyle.color, lineWidth: 2)
                        .frame(width: 28, height: 28)
                    Text("\(stageNumber)")
                        .font(settings.ui(11, .bold))
                        .foregroundStyle(settings.actionStyle.color)
                }
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 5) {
                    Text(stage.title)
                        .font(settings.ui(13, .semibold))
                        .foregroundStyle(Color(theme.foreground))
                    if !stage.text.isEmpty {
                        Text(stage.text)
                            .font(settings.ui(11))
                            .foregroundStyle(Color(theme.secondaryForeground))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !stage.definitionOfDone.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 10))
                            Text("Done when: \(stage.definitionOfDone)")
                                .font(settings.ui(10, .medium))
                        }
                        .foregroundStyle(.green)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Color.green.opacity(0.08)))
                    }
                    if let children = stage.children, !children.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(children) { child in
                                HStack(alignment: .top, spacing: 6) {
                                    Image(systemName: "arrow.turn.down.right")
                                        .font(.system(size: 9))
                                        .foregroundStyle(Color(theme.secondaryForeground))
                                    Text(child.title)
                                        .font(settings.ui(11))
                                        .foregroundStyle(Color(theme.secondaryForeground))
                                }
                            }
                        }
                        .padding(.leading, 4)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)

            if !isLast {
                Rectangle()
                    .fill(Color(theme.border).opacity(0.7))
                    .frame(width: 2, height: 20)
                    .padding(.leading, 13)
            }
        }
    }

    /// Extract the numeric suffix from the stage id ("s3" → 3).
    private var stageNumber: String {
        String(stage.id.dropFirst())
    }
}
