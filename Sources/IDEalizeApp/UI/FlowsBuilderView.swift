import SwiftUI

/// The split-screen Flows surface: a guided conversation on the left, a live
/// workflow timeline on the right. The conversation is the source of truth; the
/// timeline is simply its visible result.
struct FlowsBuilderView: View {
    @ObservedObject var interview: FlowsInterview
    /// Fires when the user asks to run the finished flow.
    var onRun: (Flow) -> Void = { _ in }
    /// Fires when the user asks to save the finished flow to the library.
    var onSave: (Flow) -> Void = { _ in }
    /// Fires when the user asks the terminal AI to take over the interview.
    var onAskAgent: () -> Void = {}
    /// Whether the terminal AI is currently available to interview.
    var agentAvailable: Bool = false
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }
    @State private var draft = ""

    var body: some View {
        HStack(spacing: 0) {
            conversationPane
            Rectangle().fill(Color(theme.border)).frame(width: 1)
            timelinePane
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Left: guided conversation

    private var conversationPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("CONVERSATION")
                    .font(settings.ui(9, .semibold)).tracking(0.7)
                    .foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                if agentAvailable {
                    Button(action: onAskAgent) {
                        Label("Ask AI", systemImage: "sparkles")
                            .font(settings.ui(10, .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(settings.actionStyle.color)
                    .help("Let the terminal AI take over the interview")
                }
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(interview.turns) { turn in
                            TurnView(turn: turn)
                                .id(turn.id)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 12)
                }
                .onChange(of: interview.turns.count) { _, _ in
                    if let last = interview.turns.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            if !interview.currentOptions.isEmpty {
                optionButtons
            }

            inputBar
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(theme.background).opacity(0.35))
    }

    private var optionButtons: some View {
        HStack(spacing: 8) {
            ForEach(interview.currentOptions, id: \.self) { option in
                Button(action: { interview.choose(option) }) {
                    Text(option)
                        .font(settings.ui(12, .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill(settings.actionStyle.fill))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(theme.surface).opacity(0.5))
    }

    private var inputBar: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color(theme.border).opacity(0.6)).frame(height: 1)
            HStack(spacing: 10) {
                TextField(interview.currentPrompt.isEmpty ? "Type your answer…" : interview.currentPrompt,
                          text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(settings.ui(13))
                    .foregroundStyle(Color(theme.foreground))
                    .lineLimit(1...4)
                    .onSubmit(submit)
                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(settings.actionStyle.fill))
                }
                .buttonStyle(.plain)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
        }
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        interview.submit(text)
        draft = ""
    }

    // MARK: - Right: live workflow timeline

    private var timelinePane: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("YOUR FLOW")
                    .font(settings.ui(9, .semibold)).tracking(0.7)
                    .foregroundStyle(Color(theme.secondaryForeground))
                Spacer()
                if !interview.stages.isEmpty {
                    Button(action: { onRun(interview.flow) }) {
                        Label("Run", systemImage: "play.fill")
                            .font(settings.ui(11, .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(settings.actionStyle.color)
                    Button(action: { onSave(interview.flow) }) {
                        Label("Save", systemImage: "square.and.arrow.down")
                            .font(settings.ui(11, .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(settings.actionStyle.color)
                }
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)

            ScrollView {
                if interview.stages.isEmpty {
                    emptyTimeline
                } else {
                    FlowsTimelineView(stages: interview.stages)
                        .padding(.horizontal, 16).padding(.bottom, 16)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var emptyTimeline: some View {
        VStack(spacing: 10) {
            Image(systemName: "wand.and.stars")
                .font(.system(size: 24))
                .foregroundStyle(Color(theme.secondaryForeground).opacity(0.6))
            Text("Your flow will appear here as you answer questions.")
                .font(settings.ui(12))
                .foregroundStyle(Color(theme.secondaryForeground))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 24)
    }
}

/// One bubble in the conversation transcript.
private struct TurnView: View {
    let turn: InterviewTurn
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: turn.speaker == .ai ? "sparkles" : "person.crop.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(turn.speaker == .ai ? settings.actionStyle.color : Color(theme.secondaryForeground))
                .frame(width: 18)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 6) {
                Text(turn.text)
                    .font(settings.ui(12))
                    .foregroundStyle(Color(theme.foreground))
                    .fixedSize(horizontal: false, vertical: true)
                if let stage = turn.stage {
                    StagePreviewCard(stage: stage)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10)
            .fill(turn.speaker == .ai ? Color(theme.surface).opacity(0.7) : settings.actionStyle.color.opacity(0.08)))
    }
}

/// A small preview of a proposed stage, shown inside the AI's question bubble.
private struct StagePreviewCard: View {
    let stage: FlowStage
    @ObservedObject private var settings = AppSettings.shared
    private var theme: Theme { settings.theme }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(stage.title)
                .font(settings.ui(11, .semibold))
                .foregroundStyle(Color(theme.foreground))
            if !stage.text.isEmpty {
                Text(stage.text)
                    .font(settings.ui(10))
                    .foregroundStyle(Color(theme.secondaryForeground))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !stage.definitionOfDone.isEmpty {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.seal")
                        .font(.system(size: 9))
                    Text(stage.definitionOfDone)
                        .font(settings.ui(9))
                }
                .foregroundStyle(.green)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(theme.background).opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(theme.border).opacity(0.6), lineWidth: 1))
    }
}
